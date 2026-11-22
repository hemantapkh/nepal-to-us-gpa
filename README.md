# Nepal to US GPA

Convert your **Tribhuvan University (TU)** or other Nepal percentage into an estimated **US GPA on the 4.0 or 4.3 scale**, course by course, for US grad school applications.

**Use it here: <https://gpa.hemantapkh.com>**

Made for Nepali students (BSc CSIT, BIT, BE, BBA and more) who need to self-report a GPA on US university application forms.

## Features

- **Course-by-course GPA**, weighted by credits, the way US schools calculate it
- **Overall percentage** mode for a quick estimate
- **17 Nepal grading scales**, covering Tribhuvan, Purbanchal and Agriculture and Forestry universities, secondary school and more
- **4.0 and 4.3** US scales
- **Paste from Excel or Google Sheets** instead of typing every course
- **Download a PDF report**, with your name and degree if you want, or export to Excel (.csv)
- **Private**: everything stays in your browser

See the [common questions](https://gpa.hemantapkh.com/faq.html) for which scale to pick and how the conversion works.

## Run locally

```sh
python3 -m http.server
```

Then open <http://localhost:8000>. Add `?demo=1` to the address to see sample data.

## Tests

```sh
npm test
```

## Contributing

- **Grading scales** are in `data/scales.json`. Run the tests after editing.
- **FAQ** questions are in `data/faq.json`. Run `npm run faq` after editing to update `faq.html`.

## Credit and disclaimer

Grading scales from [Scholaro](https://www.scholaro.com/db/Countries/Nepal/Grading-System) (not affiliated).

This is an unofficial estimate. Universities and credential evaluators such as WES may calculate your GPA differently. Always follow each school's instructions.
