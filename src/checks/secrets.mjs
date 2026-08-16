/**
 * §3.8.1 / launch checklist — no secret in `globals.json`, and none in the
 * built output, client *or* server.
 *
 * This is the one check here whose failure is not a broken page but a
 * disclosed credential, and it is the one the standard flags as passing every
 * compile, lint and typecheck while being completely broken. `globals.json` is
 * editable content — whatever is in it is visible to anyone who can open the
 * editor, and anything rendered from it is visible to the world.
 *
 * ADVISORY, but only because a false positive here is cheap to dismiss and the
 * cost of not looking is not. Promote it the moment a site is clean.
 *
 * DELIBERATELY NARROW. It matches key SHAPES with a recognisable prefix, not
 * "anything that looks random" — a check that flags every hash and build id
 * gets switched off within a day, and then nothing is looking at all.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const NAME = "secrets";

/**
 * Prefixed, self-identifying credentials. Every one of these is issued by a
 * provider in a form that says what it is, which is what makes matching them
 * reliable enough to act on.
 */
const PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, "an OpenAI-style secret key"],
  [/\bsk_live_[A-Za-z0-9]{10,}/, "a Stripe live secret key"],
  [/\brk_live_[A-Za-z0-9]{10,}/, "a Stripe live restricted key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic API key"],
  [/\bghp_[A-Za-z0-9]{30,}/, "a GitHub personal access token"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, "a GitHub fine-grained token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key id"],
  [/\bre_[A-Za-z0-9]{20,}/, "a Resend API key"],
  [/\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, "a SendGrid API key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  // Requires actual key MATERIAL after the header, not the header alone. The
  // `jose` library ships PEM-parsing code containing the bare header string,
  // and the bundler copies it into the serverless function — matching on the
  // header told a site to rotate a key that does not exist. A security check
  // that cries wolf is one people stop reading, which is the worst outcome.
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\s]{100,}/, "a private key"],
  [/\bservice_role\b[^\n]{0,40}\beyJ[A-Za-z0-9_-]{20,}/, "a Supabase service-role key"],
];

/** A key NAME carrying a non-empty value, in content that authors can edit. */
const SUSPICIOUS_KEY = /"(?:[a-z_]*(?:secret|password|passwd|private_key|api_?key|access_token|client_secret)[a-z_]*)"\s*:\s*"([^"]{8,})"/i;

function scan(text) {
  for (const [re, what] of PATTERNS) {
    const m = re.exec(text);
    if (m) return { what, sample: m[0].slice(0, 12) };
  }
  return null;
}

export function checkSecrets(config, report) {
  let examined = 0;

  // 1. Editable content. `globals.json` is the one an author can open.
  for (const rel of ["content/globals.json", "site.json"]) {
    const p = join(config.root, rel);
    if (!existsSync(p)) continue;
    examined += 1;
    const text = readFileSync(p, "utf8");
    const hit = scan(text);
    if (hit) {
      report.warn(NAME, `${rel} contains ${hit.what} (starts "${hit.sample}…"). Editable content is visible to anyone who can open the editor (§3.8.1).`, { rule: "secrets" });
    }
    const named = SUSPICIOUS_KEY.exec(text);
    if (named) {
      report.warn(NAME, `${rel} has a key named like a credential with a value set: ${named[0].slice(0, 60)}… — secrets belong in the environment, not in content (§3.8.1).`, { rule: "secrets" });
    }
  }

  // 2. The built output, client and server. Anything here has shipped.
  if (config.distDir) {
    const roots = [join(config.root, config.distDir), join(config.root, ".vercel/output")];
    for (const root of roots) {
      if (!existsSync(root)) continue;
      const files = [];
      (function walk(dir) {
        for (const e of readdirSync(dir)) {
          const full = join(dir, e);
          // node_modules is third-party source. `jose` ships PEM-parsing code
          // containing the literal "-----BEGIN PRIVATE KEY-----", and the
          // bundler copies it into the function. Flagging that told a site to
          // rotate a key that does not exist — and a security check that cries
          // wolf is one people stop reading, which is the worst outcome here.
          if (statSync(full).isDirectory()) {
            if (e === "node_modules") continue;
            walk(full);
          }
          else if (/\.(html|js|mjs|json|txt|css)$/.test(e)) files.push(full);
        }
      })(root);

      for (const f of files) {
        examined += 1;
        const hit = scan(readFileSync(f, "utf8"));
        if (hit) {
          report.warn(
            NAME,
            `${relative(config.root, f).split(sep).join("/")} contains ${hit.what} (starts "${hit.sample}…"). ` +
              `This has shipped — treat the key as disclosed and rotate it.`,
            { rule: "secrets" },
          );
        }
      }
    }
  }

  report.examined(NAME, examined);
}
