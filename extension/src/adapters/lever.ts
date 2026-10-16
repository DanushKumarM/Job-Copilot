// Lever application forms: jobs.lever.co/<site>/<posting id>/apply, confirmed at .../thanks.

import { type Adapter } from "./fill";
import { pageText } from "./dom";

const CONFIRMED = /application submitted|thank(s| you) for applying/i;

export const lever: Adapter = {
  name: "lever",
  fields: {
    full_name: ["input[name='name']"],
    email: ["input[name='email']"],
    phone: ["input[name='phone']"],
    location: ["input[name='location']:not([role='combobox'])"],
    linkedin: ["input[name='urls[LinkedIn]']"],
    github: ["input[name='urls[GitHub]']"],
    website: ["input[name='urls[Portfolio]']", "input[name='urls[Other]']"],
  },
  formRoot: (doc) => doc.querySelector("#application-form, form.application-form, form"),
  resumeInput: (doc) =>
    doc.querySelector<HTMLInputElement>("input[type='file'][name='resume'], input[type='file']#resume-upload-input"),
  // "Additional information" is where Lever takes a cover letter.
  coverLetterBox: (doc) => doc.querySelector<HTMLTextAreaElement>("textarea[name='comments']"),
  isConfirmation: (doc, url) => {
    if (/\/thanks\/?$/.test(url.pathname)) return true;
    if (doc.querySelector(".application-confirmation, [data-qa='msg-submit-success']")) return true;
    return CONFIRMED.test(pageText(doc).heading);
  },
};
