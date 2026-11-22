// Writes the FAQ from data/faq.json into index.html: the visible section and
// the FAQPage structured data for Google. Run: npm run faq
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderFaq(questions) {
  const items = questions.map(({ q, a }) => [
    '      <details class="faq-item">',
    `        <summary>${esc(q)}</summary>`,
    `        <p>${esc(a)}</p>`,
    '      </details>',
  ].join('\n')).join('\n');
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(({ q, a }) => ({
      '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  }, null, 2).replace(/</g, '\\u003c');
  return { items, jsonld };
}

export function applyFaq(html, questions) {
  const { items, jsonld } = renderFaq(questions);
  const swap = (src, name, body) => {
    const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(\\s*<!-- ${name}:end -->)`);
    if (!re.test(src)) throw new Error(`index.html is missing the ${name} markers`);
    return src.replace(re, (_, a, b) => `${a}\n${body}${b}`);
  };
  html = swap(html, 'faq-data', `  <script type="application/ld+json">\n${jsonld}\n  </script>`);
  return swap(html, 'faq-items', items);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { questions } = JSON.parse(readFileSync(new URL('data/faq.json', root), 'utf8'));
  const file = new URL('index.html', root);
  writeFileSync(file, applyFaq(readFileSync(file, 'utf8'), questions));
  console.log(`FAQ updated: ${questions.length} questions`);
}
