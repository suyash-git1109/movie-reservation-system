# 🎬 CinePass — Production-Grade Movie Reservation Engine

An advanced full-stack movie reservation and ticketing platform featuring **in-memory concurrency locks with auto-release TTL**, interactive cinema seat matrix, digital ticket pass generator with QR code, and real-time box office analytics.

Built as an advanced full-stack challenge from [roadmap.sh/projects/movie-reservation-system](https://roadmap.sh/projects/movie-reservation-system).

---

## 🌟 Key Engineering Highlights

- 🔒 **Concurrency & Double-Booking Prevention:** Implements an in-memory lock engine with a **10-minute TTL (Time To Live)**. If payment/checkout is not completed within 10 minutes, the lock automatically expires and frees the seats for other buyers.
- 💺 **Interactive Luxury Theater Seat Map:** Realistic curved cinema screen layout with 3 pricing tiers:
  - **Classic:** Rows A–B (₹180)
  - **Prime:** Rows C–D (₹280)
  - **VIP Recliner:** Rows E–F (₹450)
- 🎟️ **Digital Boarding Pass Generator:** Generates a movie ticket with booking ID, screen, hall, and live scannable QR code.
- 📊 **Admin Dashboard & Analytics:** Real-time visibility into total tickets sold, gross box office collection, and occupancy.
- ⚡ **Zero-Bloat Native Architecture:** Built using pure Node.js HTTP engine with RESTful endpoints and no external heavy dependencies.

---

## 🏗️ System Architecture