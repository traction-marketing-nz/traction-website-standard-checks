/**
 * Collecting findings, and printing them the way a person can act on.
 *
 * Every finding names the offender and says what is wrong with it. That format
 * is the whole product: a check that says "SEO check failed" costs more than it
 * saves, because the next person has to reproduce it before they can start.
 *
 * TWO SEVERITIES, and the split is what makes this adoptable. An `error` is
 * something a visitor gets: a dead redirect, an empty stylesheet, a 404 nobody
 * routes to. A `warning` is debt: an image without dimensions, a hotlinked
 * asset. Running the first version against an existing site produced 184
 * findings, all of them the second kind — and a gate that refuses today's
 * change over last year's debt is one people learn to route around. Warnings
 * are printed in full and block nothing until a site promotes them, which is
 * how a site ratchets rather than declares bankruptcy.
 */

export class Report {
  constructor({ promote = [] } = {}) {
    this.findings = [];
    this.skips = [];
    this.counts = {};
    this.promote = new Set(promote);
  }

  /** Something a visitor receives. Blocks. */
  fail(check, message, { rule = null } = {}) {
    this.findings.push({ check, message, rule, severity: "error" });
  }

  /**
   * Debt worth naming and not worth blocking — until a site says otherwise.
   * `rule` is the handle a site promotes by, e.g. "dimensions".
   */
  warn(check, message, { rule = null } = {}) {
    const severity = rule && this.promote.has(rule) ? "error" : "warning";
    this.findings.push({ check, message, rule, severity });
  }

  /**
   * Record that a check could not run. NOT a silent pass.
   *
   * This is the failure mode the package exists to remove: on one site the
   * redirect assertion sat inside a loop over wildcard rules, the site had no
   * wildcards, and the build printed clean over twelve dead redirects for
   * weeks. A check that examined nothing has to say so.
   */
  skip(check, reason) {
    this.skips.push({ check, reason });
  }

  /** How many things a check actually looked at — the floor against vacuous passes. */
  examined(check, n) {
    this.counts[check] = (this.counts[check] ?? 0) + n;
  }

  get errors() {
    return this.findings.filter((f) => f.severity === "error");
  }

  get warnings() {
    return this.findings.filter((f) => f.severity === "warning");
  }

  get ok() {
    return this.errors.length === 0;
  }

  /** Human output. Returns the exit code the CLI should use. */
  print(log = console.log) {
    for (const { check, reason } of this.skips) log(`~ ${check}: SKIPPED — ${reason}`);

    const group = (findings, mark) => {
      const byCheck = new Map();
      for (const f of findings) {
        if (!byCheck.has(f.check)) byCheck.set(f.check, []);
        byCheck.get(f.check).push(f);
      }
      for (const [check, items] of byCheck) {
        log(`\n${mark} ${check}`);
        // Long runs of the same rule are debt, not news. Show enough to act on
        // and say how many more, so the output stays readable and honest.
        const byRule = new Map();
        for (const i of items) {
          const k = i.rule ?? "_";
          if (!byRule.has(k)) byRule.set(k, []);
          byRule.get(k).push(i);
        }
        for (const [rule, group] of byRule) {
          for (const i of group.slice(0, 5)) log(`    ${i.message}`);
          if (group.length > 5) {
            log(`    …and ${group.length - 5} more${rule !== "_" ? ` (${rule})` : ""}.`);
          }
        }
      }
    };

    if (this.errors.length) group(this.errors, "✗");
    if (this.warnings.length) group(this.warnings, "!");

    const examined = Object.entries(this.counts).map(([c, n]) => `${c} ${n}`).join(", ");
    log("");
    if (this.ok) {
      log(`✓ Standard checks passed${examined ? ` — examined ${examined}` : ""}.`);
      if (this.warnings.length) {
        log(`  ${this.warnings.length} warning(s) — debt, not a blocker. Promote a rule in ` +
            `site-checks.config.json ("promote": ["dimensions"]) once it is clean, so it cannot come back.`);
      }
      return 0;
    }
    log(`${this.errors.length} problem(s) a visitor would see${this.warnings.length ? `, and ${this.warnings.length} warning(s)` : ""}.`);
    return 1;
  }
}
