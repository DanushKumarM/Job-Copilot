// @vitest-environment jsdom
// Adapters against hand-written fixtures shaped like Greenhouse and Lever forms (design 15.1: never live sites).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { labelOf } from "../src/adapters/dom";
import { type Packet, fill, keyForLabel, values } from "../src/adapters/fill";
import { adapterFor, greenhouse, lever } from "../src/adapters/index";

// Tests run from the extension directory (npm test).
const fixture = (name: string) => readFileSync(resolve("test/fixtures", name), "utf8");

function load(name: string) {
  const html = fixture(name).replace(/<script[\s\S]*?<\/script>/g, "");
  document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, "");
}

const packet: Packet = {
  application_id: "00000000-0000-0000-0000-000000000001",
  job_title: "Backend Engineer",
  company: "Acme",
  documents: {
    resume_bullets: ["Built Python billing services handling 2 million invoices a month"],
    cover_letter: ["Built Python billing services for payments.", "Designed PostgreSQL schemas for the payments platform."],
  },
  answers: {
    full_name: "Asha Rao",
    email: "asha@example.com",
    phone: "+91 98765 43210",
    location: "Bengaluru",
    linkedin: "https://linkedin.com/in/asharao",
    github: "https://github.com/asharao",
    website: "https://asharao.dev",
    notice_period: "30 days",
    work_authorization: "Yes",
    expected_ctc: "32 LPA",
  },
  questions: {
    full_name: "Full name",
    notice_period: "What is your notice period?",
    work_authorization: "Are you authorised to work in India?",
    expected_ctc: "What is your expected CTC?",
  },
  stale_answers: ["notice_period"],
};

const value = (selector: string) => (document.querySelector(selector) as HTMLInputElement).value;

describe("label matching", () => {
  it("maps contact labels and saved questions, and refuses lookalikes", () => {
    expect(keyForLabel("First Name*", packet)).toBe("first_name");
    expect(keyForLabel("LinkedIn Profile", packet)).toBe("linkedin");
    expect(keyForLabel("What is your notice period?", packet)).toBe("notice_period");
    expect(keyForLabel("Are you legally authorized to work in India?", packet)).toBe("work_authorization");
    // Opposite meaning to work authorisation: must not reuse its answer.
    expect(keyForLabel("Will you now or in the future require visa sponsorship to work in India?", packet)).toBeNull();
    expect(keyForLabel("Why do you want to work at Acme?", packet)).toBeNull();
  });

  it("splits a full name into first and last", () => {
    expect(values(packet)).toMatchObject({ first_name: "Asha", last_name: "Rao" });
  });
});

describe("greenhouse", () => {
  beforeEach(() => load("greenhouse-apply.html"));

  it("fills what it is sure of and lists the rest", () => {
    const report = fill(document, greenhouse, packet, null);

    expect(value("#first_name")).toBe("Asha");
    expect(value("#last_name")).toBe("Rao");
    expect(value("#email")).toBe("asha@example.com");
    expect(value("#phone")).toBe("+91 98765 43210");
    expect(value("#question_101")).toBe("https://linkedin.com/in/asharao");
    expect(value("#question_102")).toBe("https://asharao.dev");
    expect(value("#question_103")).toBe("30 days");
    expect(value("#question_104")).toBe("1"); // "Yes"
    expect(value("#question_105")).toBe(""); // sponsorship: left for the user
    expect(value("#question_106")).toBe(""); // free-text motivation: never invented
    expect(value("#candidate-location")).toBe(""); // autocomplete widget: the user picks

    expect(report.needsYou).toEqual(
      expect.arrayContaining([
        "Location (City)*",
        "Resume/CV*", // jsdom cannot attach files; the end-to-end test covers attaching
        "Will you now or in the future require visa sponsorship to work in India?*",
        "Why do you want to work at Acme?*",
        "I agree to the processing of my data*",
      ]),
    );
    expect(report.staleUsed).toEqual(["What is your notice period?"]);
    expect(document.querySelectorAll("[data-jobcopilot='filled']").length).toBe(report.filled.length);
    expect((document.getElementById("gdpr") as HTMLInputElement).checked).toBe(false);
  });

  it("never overwrites what is already typed", () => {
    (document.querySelector("#email") as HTMLInputElement).value = "other@example.com";
    fill(document, greenhouse, packet, null);
    expect(value("#email")).toBe("other@example.com");
  });

  it("recognises the confirmation page, not the form", () => {
    expect(greenhouse.isConfirmation(document, new URL("https://job-boards.greenhouse.io/acme/jobs/4012345"))).toBe(false);
    load("greenhouse-confirmation.html");
    expect(greenhouse.isConfirmation(document, new URL("https://job-boards.greenhouse.io/acme/jobs/4012345"))).toBe(true);
  });
});

describe("lever", () => {
  beforeEach(() => load("lever-apply.html"));

  it("fills contact details, links, a matching question and the cover letter", () => {
    const report = fill(document, lever, packet, null);
    expect(value("input[name='name']")).toBe("Asha Rao");
    expect(value("input[name='email']")).toBe("asha@example.com");
    expect(value("input[name='location']")).toBe("Bengaluru");
    expect(value("input[name='urls[LinkedIn]']")).toBe("https://linkedin.com/in/asharao");
    expect(value("input[name='urls[GitHub]']")).toBe("https://github.com/asharao");
    expect(value("input[name='urls[Portfolio]']")).toBe("https://asharao.dev");
    expect(value("input[name='cards[c1][field0]']")).toBe("32 LPA");
    expect(value("textarea[name='comments']")).toBe(
      "Built Python billing services for payments. Designed PostgreSQL schemas for the payments platform.",
    );
    expect(value("input[name='org']")).toBe(""); // no fact-backed value for it
    expect(report.needsYou).toContain("Have you worked with Kafka in production?✱");
  });

  it("reads labels from Lever's question blocks", () => {
    expect(labelOf(document.querySelector("input[name='phone']")!)).toBe("Phone");
  });

  it("recognises /thanks", () => {
    load("lever-thanks.html");
    const url = new URL("https://jobs.lever.co/acme/8f1c2b7e-0000-4a5b-9c1d-acme00000001/thanks");
    expect(lever.isConfirmation(document, url)).toBe(true);
  });
});

it("picks adapters by host only", () => {
  expect(adapterFor(new URL("https://boards.greenhouse.io/embed/job_app?for=acme&token=1"))?.name).toBe("greenhouse");
  expect(adapterFor(new URL("https://jobs.lever.co/acme/x/apply"))?.name).toBe("lever");
  expect(adapterFor(new URL("https://www.linkedin.com/jobs/view/1"))).toBeNull();
});
