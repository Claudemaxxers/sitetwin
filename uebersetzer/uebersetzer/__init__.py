"""SiteTwin Übersetzer (translator): quellen (raw data) → eintraege + plaene (structured database).

Step 2 in KONZEPT.md. Reads the Ablage's table `quellen` (ablage/SPEC.md §5),
writes only `eintraege`, `plaene` and, in `quellen`, exclusively `status` + `meta.fehler`.
"""
