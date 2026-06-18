const namePattern = /^[A-Za-z\u0621-\u064A\s]+$/u;

const blockedNameTerms = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'slut',
  'whore',
  'كس',
  'كسم',
  'شرموط',
  'شرموطة',
  'زق',
  'قحبة',
  'متناك',
  'خول',
];

const normalizeDisplayName = (value) =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const hasBlockedDisplayNameTerm = (value) => {
  const normalized = normalizeDisplayName(value);
  return blockedNameTerms.some((term) => normalized.includes(term));
};

const isLettersAndSpacesName = (value) => namePattern.test(value.trim());

module.exports = {
  hasBlockedDisplayNameTerm,
  isLettersAndSpacesName,
  normalizeDisplayName,
};
