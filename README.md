# AstroApex
NASA Space Apps lunar mission planner.

## Run the current website

From this repository, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory ui
```

Open http://127.0.0.1:8000/ in your browser. The complete static frontend is in `ui/`, including its scripts, styles, fonts, 3D Moon and science data.

The interface includes mission planning, visibility windows and playback, pinned A/B comparisons, a 3D Moon, polar map layers, and source documentation. It starts with bundled NASA/JPL Horizons samples for three study-region centers over 18 October–1 November 2026. The selectable demo mode uses illustrative calculations. Map layers include LROC illumination, LOLA Earth visibility, Moon Trek imagery, and Earth-observation examples from the resource catalog.

The sidebar provides rule-based explanations using the selected plan. The AI work is paused. This release contains no Qwen weights or API credentials.

## Native C/Lua backend

The native engine is independently runnable. Install a C compiler, Make, Python 3, Lua 5.4 development files and pkg-config. Download the [NAIF CSPICE toolkit](https://naif.jpl.nasa.gov/naif/toolkit_C.html) for your platform and extract it at the repository root, providing `cspice/include/SpiceUsr.h` and `cspice/lib/cspice.a`. The Linux setup is in [.github/workflows/backend.yml](.github/workflows/backend.yml).

```sh
make test
make once
```

The three required SPICE kernels are included. `make once` reads `data/input.json` and writes `data/output.json`. The static frontend uses its bundled sample series and browser calculations. It does not call a hosted backend API.

## Data and display limits

Horizons samples describe Sun/Earth geometry. Terrain is represented by a selected angular threshold. The visibility plots do not establish radio-link availability. The 3D Moon is illustrative. Historical map percentages have their own observation periods and are distinct from dated mission predictions.

Data sources, observation periods, licenses and credits are included in `ui/assets/` and the site's method and atlas pages. [Moon credits](ui/assets/moon-attribution.txt) · [Polar-map provenance](ui/assets/resources-map-provenance.txt)

## Local verification

The release passed 32 mobile/desktop browser checks and all five native backend regression tests before upload. The backend GitHub Actions workflow runs on pushes to main and pull requests.
