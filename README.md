# RouteFlex V1 — Van Route Planner

A mobile-first prototype for planning UK multi-stop van routes.

## What V1 does

- Fixed start/depot postcode support with a Return to start toggle
- Up to 30 delivery postcodes
- Bulk UK postcode validation/geocoding through Postcodes.io
- Route optimisation using OSRM Table travel-time and distance matrices
- Exact optimisation for small routes and nearest-neighbour + 2-opt for larger routes
- Final road geometry generated using OSRM Route
- Distance, driving-time and delivery-count summary
- Ordered delivery list
- One-tap handoff of the first delivery stop to Google Maps
- Responsive design for phone use

## Run locally

You can simply open `index.html` in a modern browser. If your browser blocks API requests from `file://`, run a tiny local server from this folder:

```bash
python -m http.server 8000
```

Then open:

http://localhost:8000

## GitHub Pages

1. Create a public GitHub repository.
2. Upload `index.html`, `style.css` and `app.js`.
3. Go to Settings → Pages.
4. Under Build and deployment, select "Deploy from a branch".
5. Choose `main` and `/ (root)`.
6. Save.

GitHub Pages will publish the static site.

## Services

Postcodes.io is used for UK postcode lookup/geocoding.
OSRM is used for road routing and stop-order optimisation.
OpenStreetMap tiles are used for the map display.

## Important V1 limitation

RouteFlex now builds an OSRM travel-time/distance matrix and chooses the best route from that matrix using an exact optimiser for small routes and a nearest-neighbour + 2-opt heuristic for larger routes. The final road geometry is then generated with OSRM Route.

This version does not use live traffic data, vehicle restrictions, delivery time windows, driver breaks, persistent routes or advanced navigation handoff.

## Next milestones

V1.1 — better stop editing and route details
V1.2 — Google Maps / Apple Maps / Waze destination handoff
V1.3 — saved routes and route history
V2 — driver vehicle settings and restrictions
V2 — traffic-aware routing
V3 — live route re-optimisation
