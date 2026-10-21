// The interface is in English. Much of the game's text was written in pairs, "Russian / English"
// or "Russian · English" (the hints of things you can use, a few toasts), and some hints carry the
// Russian in a <span class="ru">. en(text) keeps the English half of a pair and leaves anything
// else as it is.

const CYR = /[Ѐ-ӿ]/;
const SEPS = [' · ', ' / '];

export function en(text) {
  if (!text || typeof text !== 'string' || !CYR.test(text)) return text;
  const bare = text.replace(/<span class="ru">[^<]*<\/span>/g, '');
  if (!CYR.test(bare)) return bare;
  for (const sep of SEPS) {
    if (!bare.includes(sep)) continue;
    const keep = bare.split(sep).filter((p) => !CYR.test(p));
    if (keep.length) return keep.join(sep);
  }
  return bare;
}
