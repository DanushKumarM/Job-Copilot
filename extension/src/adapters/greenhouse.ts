// Greenhouse application forms: boards.greenhouse.io (classic), job-boards.greenhouse.io (current) and
// the embedded form (boards.greenhouse.io/embed/job_app) that company careers pages show in an iframe.

import { type Adapter } from "./fill";
import { pageText } from "./dom";

const CONFIRMED = /thank you for applying|thanks for applying|application (was |has been )?(submitted|received)/i;

export const greenhouse: Adapter = {
  name: "greenhouse",
  fields: {
    first_name: ["#first_name", "input[name='job_application[first_name]']", "input[autocomplete='given-name']"],
    last_name: ["#last_name", "input[name='job_application[last_name]']", "input[autocomplete='family-name']"],
    email: ["#email", "input[name='job_application[email]']", "input[type='email']"],
    phone: ["#phone", "input[name='job_application[phone]']", "input[type='tel']"],
  },
  formRoot: (doc) => doc.querySelector("#application-form, #application_form, form#application, form"),
  resumeInput: (doc) =>
    doc.querySelector<HTMLInputElement>(
      "input[type='file']#resume, #resume_fieldset input[type='file'], input[type='file'][name*='resume'], input[type='file'][id*='resume']",
    ),
  coverLetterBox: (doc) =>
    doc.querySelector<HTMLTextAreaElement>(
      "textarea#cover_letter_text, textarea[name='job_application[cover_letter_text]'], textarea#cover_letter",
    ),
  isConfirmation: (doc, url) => {
    if (/\/confirmation\/?$/.test(url.pathname)) return true;
    if (doc.querySelector("#application_confirmation, .application-confirmation, [data-testid='confirmation']")) return true;
    return CONFIRMED.test(pageText(doc).heading);
  },
};
