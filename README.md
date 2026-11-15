# AstroApex

**Where and when should we land on the Moon?**

AstroApex is a web app for comparing lunar landing sites and mission dates. It uses the local terrain horizon to estimate when a lander can receive sunlight and see Earth for direct communications. We built it for the **Lunar Landing Site Navigator / CLPS Lunar Mission Browser** challenge at NASA Space Apps 2026.

[Open the live app](https://fermanaliaslan.github.io/AstroApex/) · [Presentation (PDF)](doc/AstroApex-Lunar-Navigator-English.pdf) · [Navigator guide](navigator/README.md) · [NASA challenge brief](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/)

## The planning problem

At the Moon’s south pole, the Sun stays low in the sky. A crater rim or ridge can shade a lander’s solar panels or block its view of Earth. A change in landing date can alter both conditions at the same site.

AstroApex puts two mission plans side by side. Alongside total sunlight, it shows the longest stretch of darkness, the longest loss of Earth contact, and the hours when the Sun and Earth are both visible. Mission teams can use these measures to compare alternatives quickly, and students can explore why a particular site or date makes a difference.

## Features

| Area | What you can do |
|---|---|
| **Site and date comparison** | Choose from 27 named sites or enter custom coordinates. Compare two dates at one site or two sites on the same date. |
| **Sky view and timeline** | Follow the Sun and Earth relative to the local horizon, inspect visibility windows, and check the time until the next rise or set. |
| **Power and battery** | Change solar array area, power demand, and battery capacity to see how a lander fares during darkness. |
| **3D lunar map** | Explore relief, slope, permanent shadow, estimated temperature, and Earth visibility. |
| **Site scouting and rover routes** | Evaluate candidate points in NASA study regions and explore routes to permanently shadowed areas. |
| **Assistant and exports** | Recalculate a scenario for a different site or date. Share a scenario link, export the samples as CSV, or download a two-page mission report. |

The interface supports English and Turkish. Site pickers include search and coordinates, dropdowns support keyboard navigation, and the mission timeline has a draggable pointer.

## Quick start

### In a browser

[Open AstroApex](https://fermanaliaslan.github.io/AstroApex/). Use **TR / EN** in the top-right corner to switch languages.

To try a launch delay, select **Malapert Massif** for both scenarios and set the mission length to **14 days**. Start A on **8 January 2027 at 00:00 UTC** and B on **15 January 2027 at 00:00 UTC**. Compare the total joint visibility and the longest communication outage.

### On your computer

With Git and Python 3 installed, run the following commands.

```sh
git clone https://github.com/FermanAliAslan/AstroApex.git
cd AstroApex
python3 navigator/server.py --open
```

The server opens the app in your browser and prints its local address in the terminal.

### Offline

Download [navigator/dist/AstroApex.html](navigator/dist/AstroApex.html) and open it in a browser. The file contains the code and data needed for the mission calculations. If external fonts are unavailable, the app uses system fonts.

## How it works

1. **Prepare the data.** Python scripts build position tables, terrain grids, and imagery from NASA sources.
2. **Calculate the mission.** JavaScript combines Sun and Earth positions with the local horizon at the chosen coordinates and time. The visibility and power models use those results.
3. **Display the results.** HTML, CSS, and Canvas present the comparison, sky view, timeline, and lunar map.
4. **Explore and export.** The local assistant evaluates alternatives. The browser generates the PDF and CSV exports.

The repository also includes an independently runnable **C/Lua/SPICE engine**. The published Navigator runs its own calculations in the browser using bundled data.

## Data sources

| Source | Use |
|---|---|
| **NASA NAIF SPICE / JPL DE440** | Sun and Earth positions sampled every two hours for 2024–2040 in the `IAU_MOON` frame with `LT+S` corrections. |
| **LRO / LOLA** | Local horizon, elevation, and slope. Three reference locations use horizon profiles derived from 80 m terrain data. Other covered south-pole sites use a 480 m grid. |
| **NASA Goddard permanent-shadow data** | Mapping shadowed areas and assessing access to potential cold traps. |
| **NASA Lunar Surface Data Book** | Reference coordinates for study regions. |
| **LRO WAC / NASA Moon Trek** | Lunar surface imagery. |
| **astronomy-engine** | Independent position checks and calculations for dates outside the SPICE table. |

See the [Navigator data guide](navigator/README.md#nasa-data-and-sources) and [data preparation scripts](navigator/tools/) for dataset names and processing steps.

## Interpreting the results

- **Earth visibility gives a geometric communication opportunity.** Antenna performance, the radio link budget, and ground station availability also affect whether a link is usable.
- **Terrain resolution affects visibility.** The 480 m grid can miss narrow ridges, small craters, and boulders. Sunlight estimates and scout scores at these sites can be optimistic.
- **Permanent shadow identifies conditions where ice could persist.** Confirming ice at a given location requires separate measurements.
- **Suitability, battery, temperature, and propellant outputs are preliminary estimates.** Alongside the six-part score, recommendations check whether the selected battery runs empty, Earth is never visible during the mission, or the known mean slope exceeds 15°. If neither plan passes, the app explains why. Mission-specific outage limits, local landing hazards, and the radio link budget need separate assessment.
- **Sampling sets the time resolution.** The detailed simulation, assistant preview, and candidate scoring use the same time step for a given mission length. The year explorer samples every two hours. Both calculations account for terrain and eclipses. The timing of short events is limited by the sampling interval.
- **Scouting compares sampled candidates.** The scout uses approximately equal-area circles around NASA study-region centres. Rover distance is measured along the displayed path. When a route requires a higher slope limit than 15°, the app labels it accordingly.

## Repository layout

| Path | Contents |
|---|---|
| [`navigator/`](navigator/) | Source for the live application |
| [`navigator/js/`](navigator/js/) | Mission calculations, map, scouting, assistant, reports, and interface modules |
| [`navigator/data/`](navigator/data/) | Bundled ephemeris, terrain, and imagery |
| [`navigator/tools/`](navigator/tools/) | Data preparation and single-file packaging scripts |
| [`navigator/dist/`](navigator/dist/) | Offline distribution |
| [`src/`](src/) and [`lua/`](lua/) | Independent native calculation engine |
| [`data/`](data/) | SPICE kernels and example JSON for the native engine |
| [`tests/`](tests/) | Regression tests for the native engine, Navigator, and local server |
| [`ui/`](ui/) | Companion mission console with Horizons data, an atlas, and a surface-distance tool |
| [`doc/`](doc/) | Presentation and project documents |

## Development and deployment

After changing the Navigator source, rebuild the single-file edition from the repository root.

```sh
python3 navigator/tools/build_single.py
```

This creates `navigator/dist/AstroApex.html` and a version for embedding, `navigator/dist/astroapex-web.html`. Source files are on **main**. GitHub Pages serves the rebuilt `AstroApex.html` as `index.html` on the **gh-pages** branch.

### Optional local chat service

The local server can enable online chat through Anthropic. Start it from the repository root.

```sh
python3 navigator/server.py --open
```

The server looks for an available local port starting at 5173. Online chat requires the `anthropic` package and the `ANTHROPIC_API_KEY` environment variable. The terminal prints a private session link that authorizes your browser. The `--open` flag opens it automatically. Keep that link private.

If an older installation has a `navigator/api_key.txt` file, move its key to the environment variable and remove the file from the served directory. See the [server implementation](navigator/server.py) for startup and session handling.

### Browser regression tests

With Node.js 22+, Python 3, and Chromium, run the mission, assistant, route, export, and interface checks.

```sh
npm ci
npx playwright install chromium
python3 -m pip install pypdf==6.21.4
npm run build
npm test
python3 -m unittest discover -s tests -p test_navigator_server.py
```

The [Navigator workflow](.github/workflows/navigator.yml) runs these tests and checks that the standalone build matches its source. The local AI service tests use simulated provider responses.

### Native C/Lua engine and tests

Install a C compiler, Make, Python 3, Lua 5.4 development files, pkg-config, and the [NAIF CSPICE toolkit](https://naif.jpl.nasa.gov/naif/toolkit_C.html) for your platform. Extract the toolkit at the repository root so that `cspice/include/SpiceUsr.h` and `cspice/lib/cspice.a` are available.

```sh
make test
make once
```

`make test` runs the native regression suite. `make once` reads `data/input.json` and writes `data/output.json`. HTTP mode binds to 127.0.0.1 and sets separate five-second deadlines for reading a request and writing its response. With a Lua 5.4 interpreter, run `lua5.4 tests/test_json_retention.lua` to check memory retention. GitHub Actions builds and tests the engine on Linux. [Backend workflow](.github/workflows/backend.yml)

## Development tools

The team used **Claude and Codex** to develop and review the code. The data table above and the preparation scripts identify the scientific inputs. Scores and engineering estimates also depend on the assumptions in the models.
