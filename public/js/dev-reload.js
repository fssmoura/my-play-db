// Local preview only: reloads the page when it, or a stylesheet/script it
// loads from this site, changes on disk. Does nothing anywhere but localhost.
if (["localhost", "127.0.0.1"].includes(location.hostname)) {
  const seen = new Map();

  const urls = () => [
    location.href,
    ...[...document.querySelectorAll("link[rel=stylesheet][href], script[src]")]
      .map((el) => new URL(el.href || el.src, location.href))
      .filter((u) => u.origin === location.origin)
      .map((u) => u.href),
  ];

  const hash = (text) => {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return String(h);
  };

  const stamp = async (url) => {
    const res = await fetch(url, { cache: "no-store" });
    return (
      res.headers.get("etag") ||
      res.headers.get("last-modified") ||
      hash(await res.text())
    );
  };

  const check = async () => {
    try {
      for (const url of new Set(urls())) {
        const now = await stamp(url);
        if (seen.has(url) && seen.get(url) !== now) return location.reload();
        seen.set(url, now);
      }
    } catch {
      // Server restarting; try again next tick.
    }
    setTimeout(check, 1000);
  };

  check();
}
