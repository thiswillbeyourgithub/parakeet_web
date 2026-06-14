# Attribution and data licenses

The application code in this repository is licensed under **AGPL-3.0** (see the
[`LICENSE`](./LICENSE) file). Some of the phrase-boosting lists shipped under
[`phrase_boosting/`](./phrase_boosting) include names derived from a third-party
dataset (LPSN) that carries its own license. Those names are a
separately-licensed asset distributed alongside the application (an aggregate):
the app's AGPL-3.0 license does not relicense them, and their license does not
relicense the app.

## Bacterial names from LPSN (CC BY-SA 4.0)

The bacterial names come from **LPSN** (List of Prokaryotic names with Standing
in Nomenclature). LPSN data is distributed under a **Creative Commons
Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)** license. They appear in
two shipped boost lists:

- **`lorn.txt` / `lorn.pwc`** (LoRN = "List of Recommended Names for bacteria of
  medical importance"): entirely derived from LPSN.
- **`french_medical.txt` / `french_medical.pwc`**: a French medical dictionary +
  drug list into which the LoRN bacterial names are merged (see `unify.py` in the
  generator repo). Its bacterial-name portion is LPSN-derived.

Because these files are derivative works of LPSN data, their LPSN-derived content
is made available under **CC BY-SA 4.0**, not under this repository's AGPL-3.0
license. Anyone redistributing these lists must keep the attribution below, and
CC BY-SA 4.0 ShareAlike applies to further adaptations of the LPSN-derived
content.

### Required attribution

> Parte, A.C., Sardà Carbasse, J., Meier-Kolthoff, J.P., Reimer, L.C. & Göker,
> M. (2020). List of Prokaryotic names with Standing in Nomenclature (LPSN)
> moves to the DSMZ. *International Journal of Systematic and Evolutionary
> Microbiology* 70, 5607-5612. https://doi.org/10.1099/ijsem.0.004332

- Source: <https://lpsn.dsmz.de/>
- Data obtained via the official LPSN download page: <https://lpsn.dsmz.de/downloads>
  (TODO: confirm this is the exact page the `lpsn_gss_*.csv` export came from)
- License terms: <https://lpsn.dsmz.de/text/copyright>

LPSN forbids automated / bulk download except through its official download page
or API, so the boost lists must be regenerated from a manually-downloaded export
(or one fetched via the LPSN API), never by scraping the site.

---

Written with assistance from Claude Code.
