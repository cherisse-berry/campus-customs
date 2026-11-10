# Persona × journey coverage matrix

Generated from config/. ● = scenario defined. Journey L (responsive) runs P01 on tablet and mobile via `npm run batch -- --mobile`. Phase = Section 27 order.

| Persona | A | B | C | D | E | F | G | H | I | J | K | L | Scenarios (phase) | Risk notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| P01 Doctoral trainee | ● | ● |  |  |  |  |  |  |  |  | ● | ● | P01-doctoral-idea (4), K-incomplete-input (6) | shared benchmark task |
| P02 Postdoctoral fellow |  |  |  | ● |  |  |  |  |  |  |  |  | P02-postdoc-independence (5) |  |
| P03 Junior faculty investigator |  |  |  | ● |  |  |  | ● |  |  |  |  | P03-junior-program (5), H-question-revision (5) | boundary case |
| P04 Early-stage NIH investigator |  |  |  |  | ● |  |  |  |  |  |  |  | P04-esi-mechanism (5) |  |
| P05 Mid-career investigator |  |  |  |  |  |  |  |  |  | ● |  |  | P05-cross-module (5) |  |
| P06 Senior PI |  |  | ● | ● |  |  |  |  |  |  |  |  | P06-senior-critique (4) | shared benchmark task |
| P07 Multicenter consortium PI |  |  |  | ● |  |  |  |  |  |  |  |  | P07-consortium (6) |  |
| P08 Clinical / translational investigator |  |  |  | ● |  |  |  |  |  |  |  |  | P08-clinical (6) |  |
| P09 Basic scientist |  |  |  | ● |  |  |  |  |  |  |  |  | P09-basic (6) |  |
| P10 Computational scientist |  |  |  | ● |  |  |  |  |  |  |  |  | P10-computational (6) |  |
| P11 Under-resourced U.S. investigator |  |  |  |  |  |  | ● |  |  |  |  |  | P11-under-resourced (6) | shared benchmark task |
| P12 International investigator, well-resourced |  |  |  |  | ● | ● |  |  |  |  |  |  | P12-intl-well-resourced (4) | shared benchmark task |
| P13 International investigator, resource-constrained |  |  |  |  |  | ● | ● |  |  |  |  |  | P13-intl-constrained (4) | shared benchmark task; boundary case |
| P14 Research-development administrator |  |  |  | ● |  |  |  |  |  |  |  |  | P14-rd-admin (6) |  |
| P15 Department chair / research dean |  |  |  | ● |  |  |  |  |  |  |  |  | P15-dean (6) |  |
| P16 Institutional IT / privacy reviewer |  |  |  | ● |  |  |  |  |  |  |  |  | P16-it-privacy (6) |  |
| P17 Individual subscriber | ● |  |  |  |  |  |  |  |  |  |  |  | P17-subscriber (6) | needs server-side new account |
| P18 Returning investigator |  |  |  |  |  |  |  |  | ● |  |  |  | P18-returning-resume (4) |  |
| P19 Verified funder representative |  |  |  |  | ● |  |  |  |  |  |  |  | P19-funder (6) | needs role-specific account |
| P20 Founder administrator |  |  |  |  |  |  |  |  |  | ● |  |  | P20-founder-oversight (6) | needs role-specific account |

## Dimension spread (pairwise check)

| Persona | Career stage | Methods | Resources | Country | Digital literacy | First goal |
|---|---|---|---|---|---|---|
| P01 | 3rd-year PhD student | introductory (one biostatistics course) | large US public university, busy advisor | United States | high | research-first |
| P02 | 2nd-year postdoc | intermediate (multilevel models) | well-resourced private university | United States | high | research-first |
| P03 | Assistant professor, year 2 | advanced quantitative (causal inference) | mid-size university, small research office | United States | moderate | research-first |
| P04 | Assistant professor, 4 years after PhD (likely NIH ESI) | advanced | US research university | United States | high | funding-first |
| P05 | Associate professor, two R01s completed | advanced | well-resourced | United States | moderate | research-first |
| P06 | Full professor, 25 years, multiple R01s/U01 | expert (trial design) | well-resourced academic medical center | United States | moderate | research-first |
| P07 | Professor, leads a 9-site network | expert | well-resourced lead site, variable partner sites | United States + 2 non-US sites | moderate | research-first |
| P08 | Physician-scientist, Assistant professor | intermediate (clinical research training) | academic medical center with EHR data warehouse | United States | moderate | research-first |
| P09 | Assistant professor | advanced bench methods, limited statistics | core facilities available | United States | moderate | research-first |
| P10 | Research scientist | expert ML, limited clinical epidemiology | GPU cluster, one hospital's imaging data | United States | very high | research-first |
| P11 | Assistant professor with 4/4 teaching load | intermediate | small regional university; no research office, no biostatistician | United States (rural) | moderate | research-first |
| P12 | Associate professor | advanced | well-resourced university hospital | Germany | high | research-first |
| P13 | Senior lecturer (senior PI locally) | advanced | public university; limited lab, intermittent internet, small research office | Malawi | moderate | research-first |
| P14 | Director, office of research development | n/a | mid-size university | United States | high | institutional |
| P15 | Associate dean for research | advanced (former PI) | budget authority | United States | moderate | institutional |
| P16 | Information-security analyst | n/a | n/a | United States | expert | institutional |
| P17 | Assistant professor | intermediate | no institutional license | United States | high | research-first |
| P18 | Assistant professor | advanced | mid-size university | United States | moderate | research-first |
| P19 | Program officer, private foundation | advanced | n/a | United States | high | funder |
| P20 | Founder | n/a | n/a | United States | high | operations |
