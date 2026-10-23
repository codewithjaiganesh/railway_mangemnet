# RailFlow — Railway Management SaaS UI

A responsive, front-end-only railway operations dashboard built with HTML, CSS, and vanilla JavaScript.

## Included
- Login screen (demo-only; any valid email and password of 4+ characters will enter the dashboard)
- Responsive SaaS dashboard layout
- Network KPIs, booking chart, train status visualization
- Train activity table with live client-side search
- New booking modal with form validation
- Export visible train activity to CSV
- Sidebar navigation, notifications, toast messages, mobile navigation
- Railway entities inspired by the attached Railway Management System schema: trains, passengers, stations, bookings, payments and schedules

## Run locally
1. Extract the ZIP.
2. Open `index.html` in your browser, or use VS Code with the Live Server extension.
3. Demo credentials are pre-filled: `admin@railflow.io` / `railflow123`.

## Push to GitHub
Create a repository on GitHub, then open a terminal in this extracted folder and run:

```bash
git init
git add .
git commit -m "Add RailFlow SaaS UI"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

Replace the remote URL with your repository URL.

## Important limitations
This is a UI prototype, not a production system. Login is not secure authentication; booking entries are not persisted; data is sample data. Before real use, add a backend API, database, password hashing, session/token handling, role-based access control, input validation, and secure deployment configuration. Google Fonts requires an internet connection; the page otherwise uses system fallbacks.
