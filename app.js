(function () {
  "use strict";

  const ANALYTICS_KEY = "hreflangqa_analytics_events";
  const INTENT_KEY = "hreflangqa_purchase_intents";
  const GITHUB_ISSUE_URL = "https://github.com/ert93333-ops/hreflang-qa-briefs/issues/new";

  const SAMPLE_URL_MAP = [
    "group,hreflang,url,canonical",
    "home,en,https://example.com/en/,https://example.com/en/",
    "home,fr,https://example.com/fr/,https://example.com/en/",
    "home,de,https://example.com/de/,https://example.com/de/",
    "home,x-default,https://example.com/,https://example.com/",
    "pricing,en,https://example.com/en/pricing,https://example.com/en/pricing",
    "pricing,fr,https://example.com/fr/pricing,https://example.com/fr/pricing",
    "pricing,en-us,/us/pricing,https://example.com/us/pricing",
  ].join("\n");

  const SAMPLE_HEAD_SNIPPETS = [
    "PAGE: https://example.com/en/",
    '<link rel="canonical" href="https://example.com/en/">',
    '<link rel="alternate" hreflang="en" href="https://example.com/en/">',
    '<link rel="alternate" hreflang="fr" href="https://example.com/fr/">',
    '<link rel="alternate" hreflang="x-default" href="https://example.com/">',
    "",
    "PAGE: https://example.com/fr/",
    '<link rel="canonical" href="https://example.com/en/">',
    '<link rel="alternate" hreflang="en" href="https://example.com/en/">',
    '<link rel="alternate" hreflang="fr" href="https://example.com/fr/">',
    "",
    "PAGE: https://example.com/de/",
    '<link rel="canonical" href="https://example.com/de/">',
    '<link rel="alternate" hreflang="de" href="https://example.com/de/">',
    '<link rel="alternate" hreflang="fr" href="https://example.com/fr/">',
  ].join("\n");

  const state = {
    latestBrief: null,
    latestBriefText: "",
    lastRemoteBody: "",
    signupStarted: false,
    pricingTracked: false,
  };

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function setText(selector, value) {
    const element = qs(selector);
    if (element) element.textContent = value;
  }

  function readArray(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  }

  function writeArray(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Local storage can be unavailable in privacy modes. The UI still works.
    }
  }

  function getUtm() {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_content: params.get("utm_content") || "",
    };
  }

  function track(eventName, detail) {
    const events = readArray(ANALYTICS_KEY);
    events.push({
      event: eventName,
      detail: detail || {},
      utm: getUtm(),
      path: window.location.pathname,
      createdAt: new Date().toISOString(),
    });
    writeArray(ANALYTICS_KEY, events.slice(-200));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function listHtml(items, emptyText) {
    if (!items.length) return "<p>" + escapeHtml(emptyText) + "</p>";
    return "<ul>" + items.map(function (item) {
      return "<li>" + escapeHtml(item) + "</li>";
    }).join("") + "</ul>";
  }

  function lines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
  }

  function splitRow(line) {
    if (line.indexOf("\t") !== -1) return line.split("\t").map(function (part) { return part.trim(); });
    return line.split(",").map(function (part) { return part.trim(); });
  }

  function clean(value) {
    return String(value || "").replace(/^["']|["']$/g, "").trim();
  }

  function isAbsoluteUrl(value) {
    return /^https?:\/\//i.test(clean(value));
  }

  function toUrl(value) {
    try {
      return new URL(value);
    } catch (error) {
      return null;
    }
  }

  function normalizedUrl(value) {
    const url = toUrl(value);
    if (!url) return clean(value).replace(/\/+$/, "").toLowerCase();
    url.hash = "";
    const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
    return (url.protocol + "//" + url.hostname + path + url.search).toLowerCase();
  }

  function languageRoot(code) {
    return clean(code).toLowerCase().split("-")[0];
  }

  function validHreflang(code) {
    const value = clean(code).toLowerCase();
    if (value === "x-default") return true;
    return /^[a-z]{2,3}(-[a-z]{2}|-[a-z]{4})?$/.test(value);
  }

  function attr(tag, name) {
    const pattern = new RegExp(name + "\\s*=\\s*([\"'])(.*?)\\1", "i");
    const match = tag.match(pattern);
    return match ? clean(match[2]) : "";
  }

  function parseUrlMap(text) {
    return lines(text)
      .filter(function (line) {
        return !/^group\s*,\s*hreflang\s*,\s*url/i.test(line);
      })
      .map(function (line, index) {
        const parts = splitRow(line);
        return {
          group: clean(parts[0] || "default") || "default",
          code: clean(parts[1] || ""),
          url: clean(parts[2] || ""),
          canonical: clean(parts[3] || ""),
          row: index + 1,
        };
      })
      .filter(function (row) {
        return row.code || row.url;
      });
  }

  function parseHeadBlocks(text) {
    const blocks = [];
    let current = { pageUrl: "", alternates: [], canonicals: [] };

    function flush() {
      if (current.pageUrl || current.alternates.length || current.canonicals.length) blocks.push(current);
      current = { pageUrl: "", alternates: [], canonicals: [] };
    }

    lines(text).forEach(function (line) {
      const pageMatch = line.match(/^page\s*:\s*(.+)$/i);
      if (pageMatch) {
        flush();
        current.pageUrl = clean(pageMatch[1]);
        return;
      }

      if (/<link/i.test(line) && /rel\s*=\s*["']alternate["']/i.test(line)) {
        current.alternates.push({ code: attr(line, "hreflang"), url: attr(line, "href") });
      }
      if (/<link/i.test(line) && /rel\s*=\s*["']canonical["']/i.test(line)) {
        current.canonicals.push(attr(line, "href"));
      }
    });
    flush();

    return blocks.map(function (block) {
      if (!block.pageUrl) block.pageUrl = block.canonicals[0] || (block.alternates[0] && block.alternates[0].url) || "";
      return block;
    });
  }

  function groupRows(rows) {
    return rows.reduce(function (groups, row) {
      const key = row.group || "default";
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
      return groups;
    }, {});
  }

  function findRowForUrl(rows, url) {
    const key = normalizedUrl(url);
    return rows.find(function (row) {
      return normalizedUrl(row.url) === key;
    });
  }

  function analyzeHreflang(input) {
    const rows = parseUrlMap(input.urlMap);
    const blocks = parseHeadBlocks(input.headSnippets);
    const groups = groupRows(rows);
    const missingSelfReferences = [];
    const reciprocalGaps = [];
    const canonicalConflicts = [];
    const invalidCodes = [];
    const relativeUrls = [];
    const duplicateVariants = [];
    const xDefaultWarnings = [];

    rows.forEach(function (row) {
      if (!row.code || !validHreflang(row.code)) invalidCodes.push("Row " + row.row + " has invalid hreflang code: " + (row.code || "(missing)") + ".");
      if (row.url && !isAbsoluteUrl(row.url)) relativeUrls.push("Row " + row.row + " uses a non-absolute localized URL: " + row.url + ".");
      if (row.canonical && !isAbsoluteUrl(row.canonical)) relativeUrls.push("Row " + row.row + " uses a non-absolute canonical URL: " + row.canonical + ".");
      if (row.canonical && row.url && normalizedUrl(row.canonical) !== normalizedUrl(row.url)) {
        const canonicalRow = findRowForUrl(rows, row.canonical);
        if (canonicalRow && languageRoot(canonicalRow.code) !== languageRoot(row.code)) {
          canonicalConflicts.push(row.url + " canonicalizes to another language variant: " + row.canonical + ".");
        }
      }
    });

    Object.keys(groups).forEach(function (groupName) {
      const variants = groups[groupName];
      const codeCounts = variants.reduce(function (counts, row) {
        const code = clean(row.code).toLowerCase();
        counts[code] = (counts[code] || 0) + 1;
        return counts;
      }, {});
      Object.keys(codeCounts).forEach(function (code) {
        if (codeCounts[code] > 1 && code) duplicateVariants.push("Group " + groupName + " has duplicate hreflang code " + code + ".");
      });
      if (!variants.some(function (row) { return clean(row.code).toLowerCase() === "x-default"; })) {
        xDefaultWarnings.push("Group " + groupName + " has no x-default fallback.");
      }
      if (variants.filter(function (row) { return clean(row.code).toLowerCase() !== "x-default"; }).length < 2) {
        reciprocalGaps.push("Group " + groupName + " has fewer than two language variants.");
      }
    });

    blocks.forEach(function (block) {
      const blockRow = findRowForUrl(rows, block.pageUrl);
      const alternatesByUrl = new Set(block.alternates.map(function (item) { return normalizedUrl(item.url); }));
      const alternatesByCode = block.alternates.reduce(function (map, item) {
        const code = clean(item.code).toLowerCase();
        map[code] = (map[code] || 0) + 1;
        return map;
      }, {});

      block.alternates.forEach(function (item) {
        if (!item.code || !validHreflang(item.code)) invalidCodes.push("Snippet for " + block.pageUrl + " has invalid hreflang code: " + (item.code || "(missing)") + ".");
        if (item.url && !isAbsoluteUrl(item.url)) relativeUrls.push("Snippet for " + block.pageUrl + " uses non-absolute alternate URL: " + item.url + ".");
      });

      Object.keys(alternatesByCode).forEach(function (code) {
        if (alternatesByCode[code] > 1 && code) duplicateVariants.push("Snippet for " + block.pageUrl + " repeats hreflang code " + code + ".");
      });

      if (block.pageUrl && !alternatesByUrl.has(normalizedUrl(block.pageUrl))) {
        missingSelfReferences.push(block.pageUrl + " does not include a self-referencing alternate.");
      }

      block.canonicals.forEach(function (canonical) {
        if (canonical && !isAbsoluteUrl(canonical)) relativeUrls.push("Snippet for " + block.pageUrl + " uses non-absolute canonical URL: " + canonical + ".");
        if (canonical && block.pageUrl && normalizedUrl(canonical) !== normalizedUrl(block.pageUrl)) {
          const canonicalRow = findRowForUrl(rows, canonical);
          if (!blockRow || !canonicalRow || languageRoot(blockRow.code) !== languageRoot(canonicalRow.code)) {
            canonicalConflicts.push(block.pageUrl + " canonicalizes away from itself to " + canonical + ".");
          }
        }
      });

      if (blockRow && groups[blockRow.group]) {
        groups[blockRow.group].forEach(function (expected) {
          if (expected.url && !alternatesByUrl.has(normalizedUrl(expected.url))) {
            reciprocalGaps.push(block.pageUrl + " is missing alternate " + expected.code + " -> " + expected.url + ".");
          }
        });
      }

      if (!block.alternates.some(function (item) { return clean(item.code).toLowerCase() === "x-default"; })) {
        xDefaultWarnings.push("Snippet for " + block.pageUrl + " has no x-default alternate.");
      }
    });

    const issueCount = missingSelfReferences.length + reciprocalGaps.length + canonicalConflicts.length + invalidCodes.length + relativeUrls.length + duplicateVariants.length + xDefaultWarnings.length;
    return {
      status: issueCount ? "Fix before launch" : "Ready for manual review",
      rowCount: rows.length,
      blockCount: blocks.length,
      issueCount: issueCount,
      missingSelfReferences: Array.from(new Set(missingSelfReferences)),
      reciprocalGaps: Array.from(new Set(reciprocalGaps)),
      canonicalConflicts: Array.from(new Set(canonicalConflicts)),
      invalidCodes: Array.from(new Set(invalidCodes)),
      relativeUrls: Array.from(new Set(relativeUrls)),
      duplicateVariants: Array.from(new Set(duplicateVariants)),
      xDefaultWarnings: Array.from(new Set(xDefaultWarnings)),
      checklist: [
        "Confirm every localized page lists itself and all peer variants.",
        "Confirm reciprocal alternates are present across each page group.",
        "Keep canonicals aligned with the same language page unless there is deliberate consolidation.",
        "Use fully-qualified URLs for alternate and canonical tags.",
        "Add x-default when there is a neutral selector, global page, or fallback URL.",
      ],
    };
  }

  function briefToText(brief) {
    return [
      "Hreflang QA Briefs",
      "Status: " + brief.status,
      "Localized rows checked: " + brief.rowCount,
      "Head snippet blocks checked: " + brief.blockCount,
      "Issue count: " + brief.issueCount,
      "",
      "Missing self-references:",
      brief.missingSelfReferences.length ? brief.missingSelfReferences.join("\n") : "None found.",
      "",
      "Reciprocal-link gaps:",
      brief.reciprocalGaps.length ? brief.reciprocalGaps.join("\n") : "None found.",
      "",
      "Canonical conflicts:",
      brief.canonicalConflicts.length ? brief.canonicalConflicts.join("\n") : "None found.",
      "",
      "Invalid hreflang code warnings:",
      brief.invalidCodes.length ? brief.invalidCodes.join("\n") : "None found.",
      "",
      "Relative URL warnings:",
      brief.relativeUrls.length ? brief.relativeUrls.join("\n") : "None found.",
      "",
      "Duplicate variants:",
      brief.duplicateVariants.length ? brief.duplicateVariants.join("\n") : "None found.",
      "",
      "x-default recommendation:",
      brief.xDefaultWarnings.length ? brief.xDefaultWarnings.join("\n") : "No x-default gaps found.",
      "",
      "Localization launch checklist:",
      brief.checklist.join("\n"),
    ].join("\n");
  }

  function renderBrief(brief) {
    const output = qs("#brief-output");
    const copyButton = qs("#copy-brief");
    if (!output) return;
    output.classList.remove("empty");
    output.innerHTML = [
      '<div class="brief-summary">',
      '<strong>' + escapeHtml(brief.status) + '</strong>',
      '<span>' + brief.issueCount + ' issues across ' + brief.rowCount + ' URL rows and ' + brief.blockCount + ' snippet blocks</span>',
      "</div>",
      '<section class="brief-section"><h4>Missing self-references</h4>' + listHtml(brief.missingSelfReferences, "No self-reference gaps found.") + "</section>",
      '<section class="brief-section"><h4>Reciprocal-link gaps</h4>' + listHtml(brief.reciprocalGaps, "No reciprocal-link gaps found.") + "</section>",
      '<section class="brief-section"><h4>Canonical conflicts</h4>' + listHtml(brief.canonicalConflicts, "No canonical conflicts found.") + "</section>",
      '<section class="brief-section"><h4>Invalid hreflang code warnings</h4>' + listHtml(brief.invalidCodes, "No invalid hreflang codes found.") + "</section>",
      '<section class="brief-section"><h4>Relative URL warnings</h4>' + listHtml(brief.relativeUrls, "No relative URL warnings found.") + "</section>",
      '<section class="brief-section"><h4>Duplicate variants</h4>' + listHtml(brief.duplicateVariants, "No duplicate variants found.") + "</section>",
      '<section class="brief-section"><h4>x-default recommendation</h4>' + listHtml(brief.xDefaultWarnings, "No x-default gaps found.") + "</section>",
      '<section class="brief-section"><h4>Localization launch checklist</h4>' + listHtml(brief.checklist, "Checklist unavailable.") + "</section>",
    ].join("");
    setText("#output-title", "Hreflang QA brief ready");
    setText("#status-pill", brief.status);
    if (copyButton) copyButton.disabled = false;
    state.latestBrief = brief;
    state.latestBriefText = briefToText(brief);
  }

  function pulseClass(element, className, duration) {
    if (!element) return;
    element.classList.add(className);
    window.setTimeout(function () { element.classList.remove(className); }, duration || 600);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // Fall through to the textarea fallback when headless browsers block clipboard writes.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function setupAuditor() {
    const form = qs("#auditor-form");
    const urlMap = qs("#url-map");
    const headSnippets = qs("#head-snippets");
    const loadSample = qs("#load-sample");
    const error = qs("#workflow-error");
    const copyButton = qs("#copy-brief");
    if (!form || !urlMap || !headSnippets) return;

    if (loadSample) {
      loadSample.addEventListener("click", function () {
        urlMap.value = SAMPLE_URL_MAP;
        headSnippets.value = SAMPLE_HEAD_SNIPPETS;
        urlMap.focus();
        pulseClass(loadSample, "is-confirmed", 520);
        track("sample_map_loaded");
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      track("core_action_started", { triggerSource: "auditor_form" });
      if (error) error.textContent = "";

      const input = { urlMap: urlMap.value.trim(), headSnippets: headSnippets.value.trim() };
      const inputLength = input.urlMap.length + input.headSnippets.length;
      if (!input.urlMap && !input.headSnippets) {
        if (error) error.textContent = "Paste URL maps or head snippets, or load the sample before generating a hreflang QA brief.";
        track("core_action_failed", { reason: "empty_input" });
        return;
      }

      const brief = analyzeHreflang(input);
      renderBrief(brief);
      track("core_action_completed", {
        urlRowCount: brief.rowCount,
        snippetBlockCount: brief.blockCount,
        issueCount: brief.issueCount,
        status: brief.status,
        inputLength: inputLength,
      });
    });

    if (copyButton) {
      copyButton.addEventListener("click", function () {
        if (!state.latestBriefText) return;
        copyText(state.latestBriefText).then(function () {
          copyButton.textContent = "Copied brief";
          pulseClass(copyButton, "is-confirmed", 700);
          track("brief_copied", { issueCount: state.latestBrief ? state.latestBrief.issueCount : 0 });
          window.setTimeout(function () { copyButton.textContent = "Copy brief"; }, 1400);
        });
      });
    }
  }

  function buildRemoteIssue(intent) {
    const body = [
      "Hreflang QA Briefs early-access request",
      "",
      "Role: " + intent.role,
      "Localized page count: " + intent.pageCount,
      "Current hreflang QA process: " + intent.qaProcess,
      "Plan interest: " + intent.plan,
      "Willingness to pay: " + intent.budget,
      "Purchase intent: " + (intent.purchaseIntent ? "yes" : "no"),
      "",
      "Biggest localization SEO pain:",
      intent.pain,
      "",
      "Note: Email is intentionally omitted from this public issue body.",
    ].join("\n");
    state.lastRemoteBody = body;
    const params = new URLSearchParams({
      title: "Hreflang QA Briefs early-access request",
      body: body,
      labels: "early-access,purchase-intent,demo-request",
      template: "demo_request.md",
    });
    return GITHUB_ISSUE_URL + "?" + params.toString();
  }

  function setupWaitlist() {
    const form = qs("#waitlist-form");
    const status = qs("#waitlist-status");
    const handoff = qs("#handoff-panel");
    const remoteLink = qs("#remote-intent-link");
    const copyRequest = qs("#copy-request");
    const planSelect = qs("#plan");
    if (!form) return;

    form.addEventListener("focusin", function () {
      if (!state.signupStarted) {
        state.signupStarted = true;
        track("signup_started", { triggerSource: "waitlist_form" });
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!state.signupStarted) {
        state.signupStarted = true;
        track("signup_started", { triggerSource: "waitlist_submit" });
      }
      const intent = {
        email: qs("#email") ? qs("#email").value.trim() : "",
        role: qs("#role") ? qs("#role").value : "",
        pageCount: qs("#page-count") ? qs("#page-count").value : "",
        qaProcess: qs("#qa-process") ? qs("#qa-process").value.trim() : "",
        plan: planSelect ? planSelect.value : "",
        budget: qs("#budget") ? qs("#budget").value : "",
        pain: qs("#pain") ? qs("#pain").value.trim() : "",
        purchaseIntent: qs("#purchase-intent") ? qs("#purchase-intent").checked : false,
        createdAt: new Date().toISOString(),
        utm: getUtm(),
      };
      const intents = readArray(INTENT_KEY);
      intents.push(intent);
      writeArray(INTENT_KEY, intents.slice(-100));

      const remoteHref = buildRemoteIssue(intent);
      if (remoteLink) remoteLink.href = remoteHref;
      if (handoff) {
        handoff.hidden = false;
        pulseClass(handoff, "is-confirmed", 700);
      }
      if (status) status.textContent = "You are on the early access list. Public-safe request details are ready.";

      track("waitlist_submitted", { role: intent.role, plan: intent.plan, pageCount: intent.pageCount });
      track("feedback_submitted", { triggerSource: "waitlist_form", painLength: intent.pain.length });
      track("remote_intent_ready", { hasRemoteLink: Boolean(remoteHref) });
      if (intent.purchaseIntent) track("checkout_intent", { plan: intent.plan, budget: intent.budget });
    });

    if (copyRequest) {
      copyRequest.addEventListener("click", function () {
        if (!state.lastRemoteBody) return;
        copyText(state.lastRemoteBody).then(function () {
          copyRequest.textContent = "Copied request details";
          pulseClass(copyRequest, "is-confirmed", 700);
          track("remote_intent_copied", { bodyLength: state.lastRemoteBody.length });
          window.setTimeout(function () { copyRequest.textContent = "Copy request details"; }, 1500);
        });
      });
    }
  }

  function setupPlanButtons() {
    const waitlist = qs("#waitlist");
    const planSelect = qs("#plan");
    qsa(".plan-button").forEach(function (button) {
      button.addEventListener("click", function () {
        const plan = button.getAttribute("data-plan") || "";
        if (planSelect && plan) planSelect.value = plan;
        track("pricing_viewed", { triggerSource: "plan_button" });
        state.pricingTracked = true;
        track("checkout_started", { plan: plan, triggerSource: "pricing_button" });
        pulseClass(button, "is-confirmed", 500);
        if (waitlist) waitlist.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function setupTracking() {
    track("landing_viewed", { product: "Hreflang QA Briefs" });
    qsa("[data-track-cta]").forEach(function (element) {
      element.addEventListener("click", function () {
        track("cta_clicked", { cta: element.getAttribute("data-track-cta") || element.textContent.trim() });
      });
    });
    const pricing = qs("#pricing");
    if (pricing && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !state.pricingTracked) {
            state.pricingTracked = true;
            track("pricing_viewed", { triggerSource: "scroll" });
            observer.disconnect();
          }
        });
      }, { threshold: 0.35 });
      observer.observe(pricing);
    }
  }

  function setupChrome() {
    const header = qs("[data-header]");
    if (!header) return;
    function updateHeader() {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    }
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  function setupReveal() {
    const elements = qsa(".reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach(function (element) { element.classList.add("is-visible"); });
      return;
    }
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    elements.forEach(function (element) { observer.observe(element); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupTracking();
    setupChrome();
    setupReveal();
    setupAuditor();
    setupWaitlist();
    setupPlanButtons();
  });
}());
