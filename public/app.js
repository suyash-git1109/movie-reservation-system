// State Management
let currentMovies = [];
let selectedMovie = null;
let selectedShowtime = null;
let selectedSeats = new Set();
let seatPriceMap = {};
let lockTimerInterval = null;
const currentUserId = 'User-' + Math.floor(1000 + Math.random() * 9000);

// DOM Elements
const movieGrid = document.getElementById('movieGrid');
const showtimeSection = document.getElementById('showtimeSection');
const selectedMovieTitle = document.getElementById('selectedMovieTitle');
const selectedMovieMeta = document.getElementById('selectedMovieMeta');
const showtimePills = document.getElementById('showtimePills');
const seatSection = document.getElementById('seatSection');
const seatingGrid = document.getElementById('seatingGrid');
const summarySeatList = document.getElementById('summarySeatList');
const summaryTotalPrice = document.getElementById('summaryTotalPrice');
const checkoutBtn = document.getElementById('checkoutBtn');
const lockTimerBanner = document.getElementById('lockTimerBanner');
const lockCountdown = document.getElementById('lockCountdown');

// Modals
const ticketModal = document.getElementById('ticketModal');
const closeTicketBtn = document.getElementById('closeTicketBtn');
const doneBookingBtn = document.getElementById('doneBookingBtn');
const adminToggleBtn = document.getElementById('adminToggleBtn');
const adminModal = document.getElementById('adminModal');
const closeAdminBtn = document.getElementById('closeAdminBtn');

// 1. Fetch & Render Movies from Backend API
async function loadMovies() {
  try {
    const res = await fetch('/api/movies');
    const data = await res.json();
    if (data.success && data.movies.length > 0) {
      currentMovies = data.movies;
      renderMovieGrid(currentMovies);
      // Auto-select first movie
      selectMovie(currentMovies[0]);
    }
  } catch (err) {
    console.error('Error fetching movies:', err);
    movieGrid.innerHTML = '<p class="error-msg">Failed to connect to backend server. Make sure node server.js is running.</p>';
  }
}

function renderMovieGrid(movies) {
  movieGrid.innerHTML = movies.map(mov => `
    <div class="movie-card ${selectedMovie && selectedMovie.id === mov.id ? 'active' : ''}" onclick="selectMovieById('${mov.id}')">
      <img src="${mov.posterUrl}" alt="${mov.title}" class="movie-poster" loading="lazy">
      <div class="movie-info">
        <div class="movie-title">${mov.title}</div>
        <div class="movie-meta">${mov.genre} • ${mov.duration}</div>
        <div class="movie-rating">★ ${mov.rating}/5.0</div>
      </div>
    </div>
  `).join('');
}

window.selectMovieById = function(movieId) {
  const mov = currentMovies.find(m => m.id === movieId);
  if (mov) selectMovie(mov);
};

// 2. Select Movie & Show Available Showtimes
function selectMovie(movie) {
  selectedMovie = movie;
  selectedSeats.clear();
  updateSummary();
  renderMovieGrid(currentMovies);

  selectedMovieTitle.textContent = movie.title;
  selectedMovieMeta.textContent = `${movie.genre} • ${movie.duration}`;
  showtimeSection.style.display = 'block';

  // Render Showtime Pills
  showtimePills.innerHTML = movie.showtimes.map((st, index) => `
    <button class="time-pill ${index === 0 ? 'active' : ''}" onclick="selectShowtime('${st.id}')">
      ${st.time} (${st.screen})
    </button>
  `).join('');

  // Default to first showtime
  if (movie.showtimes.length > 0) {
    selectShowtime(movie.showtimes[0].id);
  }
}

// 3. Select Showtime & Fetch Real-Time Seat Matrix
window.selectShowtime = async function(showtimeId) {
  selectedShowtime = selectedMovie.showtimes.find(st => st.id === showtimeId);
  selectedSeats.clear();
  updateSummary();

  // Update active pill UI
  document.querySelectorAll('.time-pill').forEach(pill => {
    pill.classList.toggle('active', pill.textContent.includes(selectedShowtime.time));
  });

  seatSection.style.display = 'block';
  await loadSeats(showtimeId);
};

// 4. Fetch Seats Matrix from Server
async function loadSeats(showtimeId) {
  try {
    const res = await fetch(`/api/seats?showtimeId=${showtimeId}`);
    const data = await res.json();
    if (data.success) {
      renderTheaterLayout(data.seats);
    }
  } catch (err) {
    console.error('Error fetching seats:', err);
  }
}

// 5. Render 60-Seat Theater Layout by Tiers
function renderTheaterLayout(seats) {
  seatPriceMap = {};
  seats.forEach(s => { seatPriceMap[s.id] = s.price; });

  // Group seats by rows (A to F)
  const rowsMap = {};
  seats.forEach(s => {
    if (!rowsMap[s.row]) rowsMap[s.row] = [];
    rowsMap[s.row].push(s);
  });

  let html = '';
  const rowsOrder = ['A', 'B', 'C', 'D', 'E', 'F'];

  rowsOrder.forEach((rowName, idx) => {
    // Add Tier Headers
    if (idx === 0) html += `<div class="tier-label">Classic • ₹180</div>`;
    if (idx === 2) html += `<div class="tier-label">Prime • ₹280</div>`;
    if (idx === 4) html += `<div class="tier-label">VIP Recliner • ₹450</div>`;

    html += `<div class="seat-row">`;
    html += `<span class="row-name">${rowName}</span>`;

    (rowsMap[rowName] || []).forEach(seat => {
      let seatClass = seat.status; // 'available', 'locked', 'booked'
      if (selectedSeats.has(seat.id)) {
        seatClass = 'selected';
      }

      const isClickable = seat.status === 'available' || selectedSeats.has(seat.id);
      html += `
        <div class="seat-cell ${seatClass}" 
             data-id="${seat.id}" 
             ${isClickable ? `onclick="toggleSeat('${seat.id}')"` : ''}
             title="Seat ${seat.id} - ₹${seat.price} (${seat.status})">
          ${seat.num}
        </div>
      `;
    });

    html += `</div>`;
  });

  seatingGrid.innerHTML = html;
}

// 6. Interactive Seat Selection
window.toggleSeat = function(seatId) {
  if (selectedSeats.has(seatId)) {
    selectedSeats.delete(seatId);
  } else {
    if (selectedSeats.size >= 6) {
      alert('You can select a maximum of 6 seats at a time.');
      return;
    }
    selectedSeats.add(seatId);
  }
  updateSummary();
  // Re-render seating grid to reflect selected styling
  document.querySelectorAll('.seat-cell').forEach(cell => {
    const id = cell.getAttribute('data-id');
    if (!cell.classList.contains('booked') && !cell.classList.contains('locked')) {
      cell.classList.toggle('selected', selectedSeats.has(id));
      cell.classList.toggle('available', !selectedSeats.has(id));
    }
  });
};

// 7. Update Live Summary Bar
function updateSummary() {
  const seatsArray = Array.from(selectedSeats);
  if (seatsArray.length === 0) {
    summarySeatList.textContent = 'None';
    summaryTotalPrice.textContent = '₹0';
    checkoutBtn.disabled = true;
    checkoutBtn.innerHTML = 'Select Seats to Proceed';
  } else {
    summarySeatList.textContent = seatsArray.join(', ');
    const total = seatsArray.reduce((sum, id) => sum + (seatPriceMap[id] || 0), 0);
    summaryTotalPrice.textContent = `₹${total}`;
    checkoutBtn.disabled = false;
    checkoutBtn.innerHTML = `🔒 Lock ${seatsArray.length} Seat(s) & Book (₹${total})`;
  }
}

// 8. Concurrency Seat Lock & 10-Minute Countdown Timer
checkoutBtn.addEventListener('click', async () => {
  if (selectedSeats.size === 0) return;

  const seatsArray = Array.from(selectedSeats);
  const totalAmount = seatsArray.reduce((sum, id) => sum + (seatPriceMap[id] || 0), 0);

  checkoutBtn.disabled = true;
  checkoutBtn.innerHTML = 'Locking Seats...';

  try {
    // Acquire 10-Min Concurrency Lock from Backend
    const lockRes = await fetch('/api/lock-seats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        showtimeId: selectedShowtime.id,
        seats: seatsArray,
        userId: currentUserId
      })
    });

    const lockData = await lockRes.json();

    if (!lockRes.ok || !lockData.success) {
      alert(`Seat Lock Conflict: ${lockData.message || 'Selected seats were just locked or booked by someone else!'}`);
      await loadSeats(selectedShowtime.id);
      selectedSeats.clear();
      updateSummary();
      return;
    }

    // Start 10-Minute Lock Countdown Banner
    startCountdown(lockData.expiresInSeconds || 600);

    // Simulate Instant Payment Confirmation
    const bookRes = await fetch('/api/book-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        showtimeId: selectedShowtime.id,
        movieTitle: selectedMovie.title,
        screen: selectedShowtime.screen,
        showTime: selectedShowtime.time,
        seats: seatsArray,
        totalAmount,
        userId: currentUserId
      })
    });

    const bookData = await bookRes.json();

    if (bookData.success && bookData.booking) {
      showOfficialTicket(bookData.booking);
    } else {
      alert(`Booking Failed: ${bookData.message}`);
    }

  } catch (err) {
    console.error('Booking checkout error:', err);
    alert('Failed to complete booking. Please try again.');
  } finally {
    checkoutBtn.disabled = false;
    updateSummary();
  }
});

// 9. Countdown Timer Function
function startCountdown(durationSeconds) {
  clearInterval(lockTimerInterval);
  lockTimerBanner.style.display = 'block';
  let timeLeft = durationSeconds;

  lockTimerInterval = setInterval(() => {
    timeLeft--;
    const mins = Math.floor(timeLeft / 60);
    const secs = timeLeft % 60;
    lockCountdown.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (timeLeft <= 0) {
      clearInterval(lockTimerInterval);
      lockTimerBanner.style.display = 'none';
      alert('Your 10-minute seat lock has expired. Seats have been released.');
      selectedSeats.clear();
      updateSummary();
      loadSeats(selectedShowtime.id);
    }
  }, 1000);
}

// 10. Display Official Digital Ticket Modal with QR Code
function showOfficialTicket(booking) {
  clearInterval(lockTimerInterval);
  lockTimerBanner.style.display = 'none';

  document.getElementById('ticketMovieName').textContent = booking.movieTitle;
  document.getElementById('ticketScreen').textContent = booking.screen;
  document.getElementById('ticketTime').textContent = booking.showTime;
  document.getElementById('ticketSeats').textContent = booking.seats.join(', ');
  document.getElementById('ticketTotal').textContent = `₹${booking.totalAmount}`;
  document.getElementById('ticketBookingId').textContent = booking.bookingId;

  // Real QR Code Generator using Open QR API
  const qrData = encodeURIComponent(`CinePass|${booking.bookingId}|${booking.movieTitle}|${booking.seats.join(',')}|₹${booking.totalAmount}`);
  document.getElementById('ticketQrImg').src = `https://api.qrserver.com/v1/create-qr-code/?data=${qrData}&size=180x180`;

  ticketModal.style.display = 'flex';
}

closeTicketBtn.addEventListener('click', () => {
  ticketModal.style.display = 'none';
  selectedSeats.clear();
  updateSummary();
  loadSeats(selectedShowtime.id);
});

doneBookingBtn.addEventListener('click', () => {
  ticketModal.style.display = 'none';
  selectedSeats.clear();
  updateSummary();
  loadSeats(selectedShowtime.id);
});

// 11. Admin Dashboard Modal & Analytics
adminToggleBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/admin/analytics');
    const data = await res.json();
    if (data.success && data.analytics) {
      const a = data.analytics;
      document.getElementById('adminTotalBookings').textContent = a.totalBookings;
      document.getElementById('adminTotalTickets').textContent = a.totalTicketsSold;
      document.getElementById('adminTotalRevenue').textContent = a.totalRevenue;

      const recentList = document.getElementById('adminRecentList');
      if (a.recentBookings.length === 0) {
        recentList.innerHTML = '<p>No bookings confirmed yet.</p>';
      } else {
        recentList.innerHTML = a.recentBookings.map(b => `
          <div style="padding: 0.4rem 0; border-bottom: 1px solid #1b2438;">
            <strong>${b.bookingId}</strong> — ${b.movieTitle} (${b.seats.join(', ')}) • 
            <span style="color:#2ecc71;">₹${b.totalAmount}</span>
          </div>
        `).join('');
      }

      adminModal.style.display = 'flex';
    }
  } catch (err) {
    console.error('Admin analytics error:', err);
  }
});

closeAdminBtn.addEventListener('click', () => {
  adminModal.style.display = 'none';
});

// Initialize on page load
loadMovies();