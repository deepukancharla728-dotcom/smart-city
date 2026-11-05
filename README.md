# SIH Smart City Site Planning – Forma Companion Prototype

## Stack
- Frontend: HTML5 + CSS3 + vanilla JavaScript
- Backend: Node.js (Express)
- Database: In-memory store (initialized with Amaravati and Visakhapatnam seed data)
- Map: Leaflet + OpenStreetMap tiles
- Autodesk Forma: used for authoritative site/context/3D/environmental analysis; this app stores the resulting metrics and compares proposals.

## Run
1. `npm install`
2. `npm run dev`
3. Open: `http://localhost:3000`
4. Demo users:
   - Site Planner: planner / planner123
   - Layout Designer: layout / layout123
   - Constructor: constructor / constructor123

## SIH workflow
1. Site Planner adds/selects a real site of at least 1 km².
2. Use Autodesk Forma to create the geolocated project, obtain terrain/context, model buildings/roads/transport/landscape and run environmental analyses.
3. Layout Designer enters/compares proposal metrics from the Forma studies.
4. The backend calculates a transparent prototype efficiency score.
5. Constructor sees all proposals and selects the highest-ranked plan.
6. Export the winning concept from Forma to Revit/IFC/BIM as required by the final workflow.

## Efficiency score
This prototype is NOT Autodesk's official score. It is a competition-friendly weighted decision score:
sunlight 15%, daylight 15%, wind 12%, noise 8%, solar 15%, carbon 15%, terrain 10%, roads 4%, transport 4%, landscaping 2%.

Replace these weights/inputs with your team's final SIH-approved methodology and actual Forma analysis outputs.
