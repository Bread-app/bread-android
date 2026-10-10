/**
 * eas.json is gitignored (it carries env keys), so EAS never uploads it and its
 * fingerprint omits it. Hashing it locally made every build fail with a
 * runtime version mismatch.
 * @type {import('expo/fingerprint').Config}
 */
module.exports = {
  ignorePaths: ["eas.json"],
};
