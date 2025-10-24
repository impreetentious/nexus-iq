# Supported viewport policy

Nexus IQ is a local research workstation UI. Supported layouts:

| Class | Width | Shell behavior |
| --- | --- | --- |
| Desktop | ≥ 1100px | Rail inline (260px). Inspector docks as a third column when open. |
| Tablet | 768–1099px | Rail collapses behind a toggle; opens as an overlay drawer. Inspector is always an overlay (never a grid column). |
| Narrow | &lt; 768px | Same overlay chrome as tablet. Question bar compresses; topbar actions remain reachable. Dense tables switch to stacked row cards where marked. |

**Minimum supported width:** 360px. Below that, layout is best-effort only.

**Not supported as primary targets:** phone-portrait as a coding surface; multi-window split under ~768px.

Policy version: `1`. UI chrome reads `data-viewport` on `.app` (`desktop` \| `tablet` \| `narrow`).
