// Where live-walk scripts get their sign-ins. Never write a credential into the repo.
// In GitHub Actions they come from GitHub Secrets as environment variables;
// on the box they come from the untracked /workspace/.secrets/ folder.
//   secret("qa_email")             -> $QA_EMAIL, else .secrets/qa_email
//   secret("appcheck_debug_token") -> $QA_APPCHECK_DEBUG_TOKEN, else .secrets/appcheck_debug_token
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.env.SECRETS_DIR || "/workspace/.secrets";

export function secret(name) {
  const up = name.toUpperCase();
  const env = up.startsWith("QA_") ? up : "QA_" + up;
  const v = process.env[env];
  if (v && v.trim()) return v.trim();
  try {
    return readFileSync(join(DIR, name), "utf8").trim();
  } catch {
    throw new Error(`Missing sign-in: set ${env} (GitHub Secret) or add ${join(DIR, name)}`);
  }
}

// Screenshots and reports go under WALK_OUT when set (the Action uploads it), else /workspace/screenshots.
export function outDir(walk) {
  return join(process.env.WALK_OUT || "/workspace/screenshots", walk);
}
