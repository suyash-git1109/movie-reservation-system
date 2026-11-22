const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 4500;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MOVIES_FILE = path.join(DATA_DIR, 'movies.json');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');

// In-Memory Concurrency Locks (10 Minute Seat Hold with Auto-Release)
// Key: `${showtimeId}_${seatId}` -> { userId, lockedAt, expiresAt }
const seatLocks = new Map();
const LOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes

// Ensure bookings file exists
if (!fs.existsSync(BOOKINGS_FILE)) {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify([], null, 2));
}

// Background Worker: Auto-release expired seat locks every 15 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, lock] of seatLocks.entries()) {
    if (now > lock.expiresAt) {
      console.log(`[Auto-Release] Expired seat lock released: ${key}`);
      seatLocks.delete(key);
    }
  }
}, 15000);

// Helper: Read JSON file safely
function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    return [];
  }
}

// Helper: Write JSON file safely
function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Helper: Generate Seat Layout (6 Rows: A-F, 10 Columns: 1-10 = 60 Seats)
function generateSeatsForShowtime(showtimeId) {
  const bookings = readJson(BOOKINGS_FILE).filter(b => b.showtimeId === showtimeId && b.status === 'confirmed');
  const bookedSeatNumbers = new Set(bookings.flatMap(b => b.seats));
  const now = Date.now();

  const rows = ['A', 'B', 'C', 'D', 'E', 'F'];
  const seats = [];

  rows.forEach((row, rowIndex) => {
    // Pricing Tiers: A-B = Classic (₹180), C-D = Prime (₹280), E-F = Recliner (₹450)
    let tier = 'Classic';
    let price = 180;
    if (rowIndex >= 2 && rowIndex <= 3) {
      tier = 'Prime';
      price = 280;
    } else if (rowIndex >= 4) {
      tier = 'VIP Recliner';
      price = 450;
    }

    for (let num = 1; num <= 10; num++) {
      const seatId = `${row}${num}`;
      const lockKey = `${showtimeId}_${seatId}`;
      const lock = seatLocks.get(lockKey);

      let status = 'available';
      let lockExpiresIn = 0;

      if (bookedSeatNumbers.has(seatId)) {
        status = 'booked';
      } else if (lock && now < lock.expiresAt) {
        status = 'locked';
        lockExpiresIn = Math.ceil((lock.expiresAt - now) / 1000);
      }

      seats.push({
        id: seatId,
        row,
        num,
        tier,
        price,
        status,
        lockedBy: lock ? lock.userId : null,
        lockExpiresIn
      });
    }
  });

  return seats;
}

// HTTP Server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Helper for JSON response
  const jsonResponse = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Helper to parse POST body
  const parseBody = (callback) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        callback(null, parsed);
      } catch (err) {
        callback(err, null);
      }
    });
  };

  // =================== REST API ROUTES ===================

  // 1. GET /api/movies - List all movies and showtimes
  if (pathname === '/api/movies' && method === 'GET') {
    const movies = readJson(MOVIES_FILE);
    return jsonResponse(200, { success: true, count: movies.length, movies });
  }

  // 2. GET /api/seats?showtimeId=xxx - Get real-time seat matrix
  if (pathname === '/api/seats' && method === 'GET') {
    const showtimeId = parsedUrl.query.showtimeId;
    if (!showtimeId) {
      return jsonResponse(400, { success: false, message: 'showtimeId is required' });
    }
    const seats = generateSeatsForShowtime(showtimeId);
    return jsonResponse(200, { success: true, showtimeId, seats });
  }

  // 3. POST /api/lock-seats - Concurrency Lock (10 Min TTL)
  if (pathname === '/api/lock-seats' && method === 'POST') {
    return parseBody((err, body) => {
      if (err || !body.showtimeId || !body.seats || !Array.isArray(body.seats) || body.seats.length === 0) {
        return jsonResponse(400, { success: false, message: 'Invalid payload. Provide showtimeId, seats array.' });
      }

      const { showtimeId, seats, userId = 'Guest-User' } = body;
      const now = Date.now();
      const currentBookings = readJson(BOOKINGS_FILE).filter(b => b.showtimeId === showtimeId && b.status === 'confirmed');
      const bookedSet = new Set(currentBookings.flatMap(b => b.seats));

      // Conflict Check: Are any requested seats already booked or locked by someone else?
      const conflicts = [];
      seats.forEach(seatId => {
        const lockKey = `${showtimeId}_${seatId}`;
        const activeLock = seatLocks.get(lockKey);

        if (bookedSet.has(seatId)) {
          conflicts.push({ seatId, reason: 'Already booked' });
        } else if (activeLock && now < activeLock.expiresAt && activeLock.userId !== userId) {
          conflicts.push({ seatId, reason: 'Temporarily locked by another user' });
        }
      });

      if (conflicts.length > 0) {
        return jsonResponse(409, {
          success: false,
          message: 'One or more seats are unavailable.',
          conflicts
        });
      }

      // Acquire Locks
      const expiresAt = now + LOCK_DURATION_MS;
      seats.forEach(seatId => {
        const lockKey = `${showtimeId}_${seatId}`;
        seatLocks.set(lockKey, { userId, lockedAt: now, expiresAt });
      });

      return jsonResponse(200, {
        success: true,
        message: 'Seats locked successfully for 10 minutes.',
        seats,
        expiresInSeconds: Math.floor(LOCK_DURATION_MS / 1000)
      });
    });
  }

  // 4. POST /api/book-ticket - Finalize booking & generate pass
  if (pathname === '/api/book-ticket' && method === 'POST') {
    return parseBody((err, body) => {
      if (err || !body.showtimeId || !body.movieTitle || !body.seats || body.seats.length === 0) {
        return jsonResponse(400, { success: false, message: 'Missing required booking details.' });
      }

      const { showtimeId, movieTitle, screen, showTime, seats, totalAmount, customerName = 'Suyash (VIP)', customerEmail = 'guest@cinema.com', userId = 'Guest-User' } = body;
      const now = Date.now();

      // Verify that seats are indeed locked by this user and not expired
      for (const seatId of seats) {
        const lockKey = `${showtimeId}_${seatId}`;
        const lock = seatLocks.get(lockKey);
        if (!lock || lock.userId !== userId || now > lock.expiresAt) {
          return jsonResponse(400, {
            success: false,
            message: `Seat ${seatId} lock expired or invalid. Please select seats again.`
          });
        }
      }

      // Generate Unique Booking Reference (e.g. BMS-78942)
      const bookingId = 'BMS-' + Math.floor(100000 + Math.random() * 900000);
      const newBooking = {
        bookingId,
        movieTitle,
        showtimeId,
        screen: screen || 'Audi 1 (IMAX)',
        showTime: showTime || '06:45 PM',
        seats,
        seatCount: seats.length,
        totalAmount,
        customerName,
        customerEmail,
        status: 'confirmed',
        bookedAt: new Date().toISOString()
      };

      // Save to bookings.json
      const allBookings = readJson(BOOKINGS_FILE);
      allBookings.push(newBooking);
      writeJson(BOOKINGS_FILE, allBookings);

      // Release the temporary locks because they are now permanently booked
      seats.forEach(seatId => {
        seatLocks.delete(`${showtimeId}_${seatId}`);
      });

      console.log(`[New Booking Confirmed] ${bookingId} - ${movieTitle} - Seats: ${seats.join(', ')}`);

      return jsonResponse(201, {
        success: true,
        message: 'Booking confirmed successfully!',
        booking: newBooking
      });
    });
  }

  // 5. GET /api/admin/analytics - Admin dashboard reports
  if (pathname === '/api/admin/analytics' && method === 'GET') {
    const bookings = readJson(BOOKINGS_FILE).filter(b => b.status === 'confirmed');
    const totalTicketsSold = bookings.reduce((sum, b) => sum + b.seatCount, 0);
    const totalRevenue = bookings.reduce((sum, b) => sum + (Number(b.totalAmount) || 0), 0);

    return jsonResponse(200, {
      success: true,
      analytics: {
        totalBookings: bookings.length,
        totalTicketsSold,
        totalRevenue: `₹${totalRevenue.toLocaleString('en-IN')}`,
        activeLocksCount: seatLocks.size,
        recentBookings: bookings.slice(-5).reverse()
      }
    });
  }

  // =================== SERVE FRONTEND STATIC FILES ===================
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  };

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${error.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🎬 CinePass Movie Reservation Engine Running!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🔒 Concurrency Seat Locking Engine: Active (10-Min TTL)`);
  console.log(`=======================================================`);
});