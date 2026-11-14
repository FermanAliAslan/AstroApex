# AstroApex
NASA Space Apps lunar mission planner.

## Run the current website

From this repository, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory ui
```

Open http://127.0.0.1:8000/ in your browser. The complete static frontend is in `ui/`, including its scripts, styles, fonts, 3D Moon and science data.

The planner compares landing sites and dates for the [NASA Space Apps Lunar Landing Site Navigator challenge](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/). Select a preset or enter lunar coordinates and choose a 7-, 14-, 21- or 28-day period within 2026–2027. The browser uses bundled hourly JPL Horizons geometry. Pin a scenario to compare sunlight, Earth visibility, joint windows and continuous darkness. The separate demo mode uses illustrative data.

The atlas includes an interactive terrain globe, a six-stop geography tour, a surface-distance ruler and polar map layers. The globe uses 8K LROC imagery and LOLA elevations. The ruler reports the shortest arc on a sphere with a radius of 1,737.4 km. The archive includes illumination and visibility products from their original observation periods.

The sidebar provides rule-based explanations using the selected plan. The AI work is paused. This release contains no Qwen weights or API credentials.

## Native C/Lua backend

The native engine is independently runnable. Install a C compiler, Make, Python 3, Lua 5.4 development files and pkg-config. Download the [NAIF CSPICE toolkit](https://naif.jpl.nasa.gov/naif/toolkit_C.html) for your platform and extract it at the repository root, providing `cspice/include/SpiceUsr.h` and `cspice/lib/cspice.a`. The Linux setup is in [.github/workflows/backend.yml](.github/workflows/backend.yml).

```sh
make test
make once
```

The three required SPICE kernels are included. `make once` reads `data/input.json` and writes `data/output.json`. The static frontend uses its bundled sample series and browser calculations. It does not call a hosted backend API.

## Data and display limits

Each hourly sample describes the center of the Sun and Earth as seen from the selected coordinates. The three preset sites retain their original October 18–31, 2026 Horizons observer tables. For other dates and custom coordinates, the browser projects the bundled lunar-frame positions into the observer’s local sky.

In terrain mode the three preset sites use direction-dependent horizons derived from NASA’s 80 m LOLA DEM. Each profile considers terrain out to 180 km from a point 2 m above the surface. The fixed-angle model is available for comparisons and for other coordinates. Hourly sampling limits event timing. Direct-to-Earth visibility indicates a geometric opportunity. Electrical yield, battery state and radio performance require further engineering assumptions.

[Horizons data and validation](ui/assets/lunar-vectors-provenance.txt) · [Terrain horizon method](ui/assets/terrain-horizon-source.txt) · [Globe credits](ui/assets/moon-attribution.txt) · [Polar-map provenance](ui/assets/resources-map-provenance.txt)

## Native regression checks

The backend GitHub Actions workflow runs the native regression suite on pushes to main and pull requests. Run the same suite with `make test`.
