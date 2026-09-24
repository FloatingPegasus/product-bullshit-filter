/** Strings worth outlining on the live page. */

export function collectMarks(report) {
  const marks = [];
  for (const item of report.marketing || []) {
    if (item.text && item.text.length > 12) marks.push({ kind: "marketing", text: item.text.slice(0, 180) });
  }
  for (const spec of (report.specs || []).slice(0, 12)) {
    const text = `${spec.name}: ${spec.value}`;
    if (text.length > 8) marks.push({ kind: "spec", text: text.slice(0, 180) });
  }
  for (const flag of report.reviews?.flags || []) {
    if (flag.evidence && flag.evidence.length > 12) marks.push({ kind: "risk", text: flag.evidence.slice(0, 180) });
  }
  const seen = new Set();
  return marks.filter((mark) => {
    const key = mark.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 24);
}
