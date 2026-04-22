export const selectors = {
  usernameInputs: [
    "input[type='email']",
    "input[name*='email' i]",
    "input[name*='user' i]",
    "input[id*='email' i]",
    "input[id*='user' i]",
    "input[type='text']",
  ],
  passwordInputs: [
    "input[type='password']",
    "input[name*='pass' i]",
    "input[id*='pass' i]",
  ],
  nextActionNames: [/next/i, /continue/i, /proceed/i, /start/i, /resume/i],
  submitActionNames: [/submit/i, /finish/i, /check/i, /save/i, /end exam/i, /confirm/i],
  assignmentKeywords: [
    "assignment",
    "upload",
    "submission",
    "attach file",
    "project",
  ],
  footerNextButton: "button.next-button",
  footerPrevButton: "button.previous-button",
  quizStartText: /start|resume/i,
  showAllPagesLabel: /show all pages/i,
};
