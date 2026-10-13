export const normalizeDomain = (domain) => domain.replace(/^\./, '').toLowerCase();

const matchesDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/** Domain → cookie count, sorted by domain. Never exposes cookie names or values. */
export function summarizeCookieDomains(cookies) {
  const counts = cookies.reduce((acc, cookie) => {
    const domain = normalizeDomain(cookie.domain);
    return { ...acc, [domain]: (acc[domain] ?? 0) + 1 };
  }, {});
  return Object.entries(counts)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

/** Cookies whose domain equals, or is a subdomain of, one of the selected domains. */
export function filterCookiesByDomains(cookies, domains) {
  const selected = domains.map(normalizeDomain);
  return cookies.filter((cookie) => {
    const domain = normalizeDomain(cookie.domain);
    return selected.some((d) => matchesDomain(domain, d));
  });
}

/** Cookie domains that would be sent to the given page URL — a sensible default selection. */
export function suggestDomains(pageUrl, summary) {
  let host;
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return [];
  }
  return summary.map((s) => s.domain).filter((d) => matchesDomain(host, d));
}
