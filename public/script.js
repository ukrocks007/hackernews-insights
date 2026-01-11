// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
  loadFiltersFromURL();
  loadStories();
});

// Load filters from URL params
function loadFiltersFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  
  const search = urlParams.get('search') || '';
  const rating = urlParams.get('rating') || 'unrated';
  const notificationSent = urlParams.get('notificationSent') || '';
  const sortBy = urlParams.get('sortBy') || 'firstSeenAt';
  const sortOrder = urlParams.get('sortOrder') || 'desc';
  const sources = urlParams.getAll('sources');
  const topics = urlParams.getAll('topics');
  
  document.getElementById('search').value = search;
  document.getElementById('rating').value = rating;
  document.getElementById('notificationSent').value = notificationSent;
  document.getElementById('sortBy').value = sortBy;
  document.getElementById('sortOrder').value = sortOrder;
  document.getElementById('sourcesInput').value = sources.join(',');
  document.getElementById('topicsInput').value = topics.join(',');
}

// Load stories from API
async function loadStories() {
  const urlParams = new URLSearchParams(window.location.search);
  const page = urlParams.get('page') || '1';
  const limit = urlParams.get('limit') || '20';
  
  const apiUrl = `/api/stories?page=${page}&limit=${limit}&${urlParams.toString()}`;
  
  try {
    const response = await fetch(apiUrl);
    const data = await response.json();
    
    populateFilters(data.availableSources, data.availableTopics);
    populateTable(data.stories);
    populatePagination(data);
  } catch (error) {
    console.error('Error loading stories:', error);
    showStatusMessage('Error loading stories', 'error');
  }
}

// Populate filter chips
function populateFilters(availableSources, availableTopics) {
  const sourceChipsEl = document.getElementById('sourceChips');
  const topicChipsEl = document.getElementById('topicChips');
  const sourceFiltersEl = document.getElementById('sourceFilters');
  const topicFiltersEl = document.getElementById('topicFilters');
  
  const urlParams = new URLSearchParams(window.location.search);
  const selectedSources = urlParams.getAll('sources');
  const selectedTopics = urlParams.getAll('topics');
  
  if (availableSources.length > 0) {
    sourceFiltersEl.style.display = 'block';
    sourceChipsEl.innerHTML = availableSources.map(src => {
      const isSelected = selectedSources.includes(src);
      const className = isSelected ? 'chip chip-selected' : 'chip';
      return `<button class="${className}" onclick="toggleFilter('sources', '${src}')">${escapeHtml(src)}</button>`;
    }).join('');
  }
  
  if (availableTopics.length > 0) {
    topicFiltersEl.style.display = 'block';
    topicChipsEl.innerHTML = availableTopics.slice(0, 20).map(topic => {
      const isSelected = selectedTopics.includes(topic);
      const className = isSelected ? 'chip chip-selected' : 'chip';
      return `<button class="${className}" onclick="toggleFilter('topics', '${escapeHtml(topic)}')">${escapeHtml(topic)}</button>`;
    }).join('');
  }
}

// Populate stories table
function populateTable(stories) {
  const tbody = document.getElementById('storiesBody');
  const emptyState = document.getElementById('emptyState');
  const table = document.getElementById('storiesTable');
  
  if (stories.length === 0) {
    table.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }
  
  table.style.display = 'table';
  emptyState.style.display = 'none';
  
  tbody.innerHTML = stories.map(story => {
    const storyTopics = story.storyTopics.map(st => st.topic.name);
    const topicsDisplay = storyTopics.slice(0, 3).join(', ');
    const moreTopics = storyTopics.length > 3 ? ` +${storyTopics.length - 3}` : '';
    
    const statusBadge = story.notificationSent
      ? '<span class="badge sent">Sent</span>'
      : '<span class="badge pending">Pending</span>';
    
    const ratingBadge = story.rating 
      ? `<span class="badge rating-${story.rating}">${story.rating}</span>`
      : '<span class="badge unrated">UNRATED</span>';
    
    const storyLink = story.url
      ? `<a href="${story.url}" target="_blank" rel="noopener" class="story-link">${escapeHtml(story.title)}</a>`
      : `<span>${escapeHtml(story.title)}</span>`;
    
    const dateStr = new Date(story.firstSeenAt).toLocaleDateString();
    const sourceId = extractSourceFromStoryId(story.id);
    
    const matchReason = story.reason 
      ? `<span class="match-reason" title="${escapeHtml(story.reason)}">${escapeHtml(story.reason.substring(0, 80))}${story.reason.length > 80 ? '...' : ''}</span>`
      : '';

    const ratingButtons = !story.rating
      ? `<div class="rating-actions">
          <button class="rating-btn useful" onclick="submitRating('${story.id}', 'useful')" title="Useful">✓</button>
          <button class="rating-btn skip" onclick="submitRating('${story.id}', 'skip')" title="Skip">✗</button>
          <button class="rating-btn bookmark" onclick="submitRating('${story.id}', 'bookmark')" title="Bookmark">⭐</button>
        </div>`
      : `<span class="rating-set">${story.rating}</span>`;

    const tldrButton = story.url 
      ? `<button class="tldr-btn" onclick="generateTLDR('${story.id}', '${escapeHtml(story.title).replace(/'/g, "\\\\'")}')" title="Generate TLDR">📄 TLDR</button>`
      : '';

    return `<tr data-story-id="${story.id}" class="${story.rating ? 'rated' : 'unrated'}">
    <td>
      ${storyLink}
      <div class="story-meta">
        <span class="source-tag">${escapeHtml(sourceId)}</span>
        ${topicsDisplay ? `<span class="topics-inline">${escapeHtml(topicsDisplay)}${moreTopics}</span>` : ''}
        ${tldrButton}
      </div>
      ${story.reason ? `<div class="match-reason-row">${matchReason}</div>` : ''}
    </td>
    <td class="center">${story.score ?? '-'}</td>
    <td class="center">${ratingBadge}</td>
    <td class="center">${statusBadge}</td>
    <td class="center">${dateStr}</td>
    <td class="rating-cell">${ratingButtons}</td>
  </tr>`;
  }).join('');
}

// Populate pagination
function populatePagination(data) {
  const { total, page, limit, totalPages } = data;
  const paginationInfo = document.getElementById('paginationInfo');
  const paginationButtons = document.getElementById('paginationButtons');
  
  paginationInfo.textContent = `Showing ${data.stories.length} of ${total} stories (Page ${page} of ${totalPages || 1})`;
  
  const urlParams = new URLSearchParams(window.location.search);
  const buildUrl = (newPage) => {
    urlParams.set('page', String(newPage));
    return `/?${urlParams.toString()}`;
  };
  
  let buttonsHtml = '';
  if (page > 1) {
    buttonsHtml += `<a href="${buildUrl(page - 1)}">← Previous</a>`;
  } else {
    buttonsHtml += `<span class="disabled">← Previous</span>`;
  }
  
  if (page < totalPages) {
    buttonsHtml += `<a href="${buildUrl(page + 1)}">Next →</a>`;
  } else {
    buttonsHtml += `<span class="disabled">Next →</span>`;
  }
  
  paginationButtons.innerHTML = buttonsHtml;
}

// Handle filter form submission
document.getElementById('filterForm').addEventListener('submit', function(e) {
  e.preventDefault();
  const formData = new FormData(this);
  const params = new URLSearchParams();
  
  for (let [key, value] of formData) {
    if (value && value.trim()) {
      if (key === 'sources' || key === 'topics') {
        value.split(',').forEach(v => {
          if (v.trim()) params.append(key, v.trim());
        });
      } else {
        params.set(key, value);
      }
    }
  }
  
  // Reset to page 1 when filters change
  params.set('page', '1');
  
  window.location.search = params.toString();
});

// Toggle filter chips
function toggleFilter(type, value) {
  const input = document.getElementById(type + 'Input');
  const current = input.value ? input.value.split(',') : [];
  const index = current.indexOf(value);
  
  if (index > -1) {
    current.splice(index, 1);
  } else {
    current.push(value);
  }
  
  input.value = current.filter(v => v).join(',');
  
  // Submit form to apply filters
  document.getElementById('filterForm').dispatchEvent(new Event('submit'));
}

// Extract source from story ID
function extractSourceFromStoryId(storyId) {
  const match = storyId.match(/^([^:]+):/);
  return match ? match[1] : 'unknown';
}

// Escape HTML
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Show status message
function showStatusMessage(message, type) {
  const el = document.getElementById('statusMessage');
  el.textContent = message;
  el.className = `status-message ${type}`;
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
  }, type === 'error' ? 5000 : 3000);
}

// Trigger fetch
async function triggerFetch() {
  const btn = document.getElementById('fetchBtn');
  const statusEl = document.getElementById('statusMessage');
  
  btn.disabled = true;
  btn.textContent = '⏳ Fetching...';
  statusEl.style.display = 'block';
  statusEl.className = 'status-message info';
  statusEl.textContent = 'Starting fetch process...';
  
  try {
    const response = await fetch('/api/trigger-fetch', { method: 'POST' });
    const data = await response.json();
    
    if (response.status === 429) {
      statusEl.className = 'status-message error';
      statusEl.textContent = 'A fetch is already running. Please wait.';
    } else if (response.ok) {
      statusEl.className = 'status-message success';
      statusEl.textContent = 'Fetch triggered successfully! Refresh to see new stories.';
      setTimeout(() => location.reload(), 2000);
    } else {
      throw new Error(data.message || 'Unknown error');
    }
  } catch (error) {
    statusEl.className = 'status-message error';
    statusEl.textContent = 'Error: ' + error.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Trigger Fetch';
  }
}

// Submit rating
async function submitRating(storyId, rating) {
  const statusEl = document.getElementById('statusMessage');
  const row = document.querySelector(`tr[data-story-id="${storyId}"]`);
  const ratingCell = row?.querySelector('.rating-cell');
  
  if (!ratingCell) return;
  
  const originalContent = ratingCell.innerHTML;
  ratingCell.innerHTML = '<span class="rating-set">⏳ Saving...</span>';
  
  try {
    const response = await fetch('/api/submit-rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyId, rating })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      ratingCell.innerHTML = `<span class="rating-set">${rating}</span>`;
      row.classList.remove('unrated');
      row.classList.add('rated');
      showStatusMessage(`Rating saved: ${rating}`, 'success');
    } else {
      throw new Error(data.message || 'Failed to save rating');
    }
  } catch (error) {
    ratingCell.innerHTML = originalContent;
    showStatusMessage('Error: ' + error.message, 'error');
  }
}

// Close TLDR modal
function closeTLDRModal() {
  const modal = document.getElementById('tldrModal');
  modal.classList.remove('show');
}

// Close modal on background click
document.getElementById('tldrModal').addEventListener('click', function(e) {
  if (e.target === this) {
    closeTLDRModal();
  }
});

// Generate TLDR
async function generateTLDR(storyId, storyTitle) {
  const modal = document.getElementById('tldrModal');
  const modalBody = document.getElementById('tldrModalBody');
  const modalTitle = document.getElementById('tldrModalTitle');
  
  // Update modal title with story title
  modalTitle.textContent = '📄 ' + storyTitle;
  
  // Show modal with loading state
  modal.classList.add('show');
  modalBody.innerHTML = `
    <div class="tldr-loading">
      <div class="spinner"></div>
      <p>Generating TLDR summary...</p>
      <p style="font-size: 12px; margin-top: 8px;">This may take 10-30 seconds</p>
    </div>
  `;
  
  try {
    const response = await fetch('/api/generate-tldr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyId })
    });
    
    const data = await response.json();
    
    if (response.ok && data.tldr) {
      // Format TLDR content
      const tldrHtml = data.tldr
        .split('\n')
        .map(line => line.trim())
        .filter(line => line)
        .map(line => {
          if (line.startsWith('- ') || line.startsWith('* ')) {
            return '<li>' + line.substring(2) + '</li>';
          }
          return '<p>' + line + '</p>';
        })
        .join('');
      
      const wrappedHtml = tldrHtml.includes('<li>') 
        ? '<ul>' + tldrHtml.replace(/<\/p>|<p>/g, '') + '</ul>'
        : tldrHtml;
      
      const metaInfo = data.cached 
        ? '<p style="color: #059669;">✓ Cached result</p>'
        : `<p>Generated with ${data.model || 'qwen3:1.7b'}</p>
           <p>Content length: ~${Math.round((data.contentLength || 0) / 1000)}K characters</p>`;
      
      modalBody.innerHTML = `
        <div class="tldr-content">
          ${wrappedHtml}
        </div>
        <div class="tldr-meta">
          ${metaInfo}
        </div>
      `;
    } else {
      throw new Error(data.message || 'Failed to generate TLDR');
    }
  } catch (error) {
    modalBody.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #991b1b;">
        <p style="font-size: 18px; margin-bottom: 8px;">⚠️ Error</p>
        <p>${error.message}</p>
      </div>
    `;
  }
}