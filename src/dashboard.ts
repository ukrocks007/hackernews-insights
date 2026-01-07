import { getPrismaClient } from './prismaClient';

interface StoriesQueryParams {
  page: number;
  limit: number;
  notificationSent?: boolean | null;
  search?: string;
  sortBy?: 'date' | 'score' | 'relevanceScore' | 'firstSeenAt';
  sortOrder?: 'asc' | 'desc';
}

interface StoryWithTopics {
  id: string;
  title: string;
  url: string | null;
  score: number | null;
  rank: number | null;
  date: string;
  reason: string | null;
  relevanceScore: number;
  notificationSent: boolean;
  firstSeenAt: Date;
  lastNotifiedAt: Date | null;
  suppressedUntil: Date | null;
  storyTopics: Array<{ topic: { name: string } }>;
  feedbackEvents: Array<{ action: string; createdAt: Date }>;
}

interface PaginatedResult {
  stories: StoryWithTopics[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getStoriesPaginated(params: StoriesQueryParams): Promise<PaginatedResult> {
  const prisma = getPrismaClient();
  const { page, limit, notificationSent, search, sortBy = 'firstSeenAt', sortOrder = 'desc' } = params;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (notificationSent !== null && notificationSent !== undefined) {
    where.notificationSent = notificationSent;
  }
  if (search) {
    where.title = { contains: search };
  }

  const [stories, total] = await Promise.all([
    prisma.story.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        storyTopics: { include: { topic: true } },
        feedbackEvents: { select: { action: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 },
      },
    }),
    prisma.story.count({ where }),
  ]);

  return {
    stories,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderHomePage(
  data: PaginatedResult,
  filters: { notificationSent: string; search: string; sortBy: string; sortOrder: string }
): string {
  const { stories, total, page, totalPages } = data;
  const { notificationSent, search, sortBy, sortOrder } = filters;

  const buildUrl = (newPage: number) => {
    const params = new URLSearchParams();
    params.set('page', String(newPage));
    if (notificationSent) params.set('notificationSent', notificationSent);
    if (search) params.set('search', search);
    if (sortBy) params.set('sortBy', sortBy);
    if (sortOrder) params.set('sortOrder', sortOrder);
    return `/?${params.toString()}`;
  };

  const storyRows = stories
    .map((story) => {
      const topics = story.storyTopics
        .map((st) => st.topic.name)
        .slice(0, 3)
        .join(', ');
      const statusBadge = story.notificationSent
        ? '<span class="badge sent">Sent</span>'
        : '<span class="badge pending">Pending</span>';
      const storyLink = story.url
        ? `<a href="${story.url}" target="_blank" rel="noopener" class="story-link">${escapeHtml(story.title)}</a>`
        : `<span>${escapeHtml(story.title)}</span>`;
      const dateStr = new Date(story.firstSeenAt).toLocaleDateString();

      // Check if feedback exists
      const hasFeedback = story.feedbackEvents.length > 0;
      const feedbackActions = story.feedbackEvents.map((fe) => fe.action).join(', ');

      const feedbackCell = hasFeedback
        ? `<span class="feedback-status has-feedback" title="${escapeHtml(feedbackActions)}">✓ ${escapeHtml(feedbackActions.split(',')[0])}</span>`
        : `<div class="feedback-actions">
            <button class="feedback-btn approve" onclick="submitFeedback('${story.id}', 'approve')" title="Approve">👍</button>
            <button class="feedback-btn reject" onclick="submitFeedback('${story.id}', 'reject')" title="Reject">👎</button>
            <button class="feedback-btn irrelevant" onclick="submitFeedback('${story.id}', 'irrelevant')" title="Irrelevant">🚫</button>
          </div>`;

      return `<tr data-story-id="${story.id}">
      <td>${storyLink}</td>
      <td>${story.score ?? '-'}</td>
      <td>${story.relevanceScore}</td>
      <td>${statusBadge}</td>
      <td><span class="topics">${escapeHtml(topics) || '-'}</span></td>
      <td>${dateStr}</td>
      <td class="feedback-cell">${feedbackCell}</td>
    </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HN Insights - Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: #1f2937;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }
    .header h1 {
      color: #fff;
      margin: 0;
      font-size: 28px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header-actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #fff;
      color: #667eea;
    }
    .btn-primary:hover {
      background: #f3f4f6;
      transform: translateY(-1px);
    }
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15);
      overflow: hidden;
    }
    .filters {
      padding: 20px 24px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      align-items: center;
    }
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .filter-group label {
      font-size: 12px;
      font-weight: 500;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .filter-group input, .filter-group select {
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      min-width: 140px;
    }
    .filter-group input:focus, .filter-group select:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    .table-wrapper {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 14px 16px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
    }
    th {
      background: #f9fafb;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6b7280;
    }
    tr:hover {
      background: #f9fafb;
    }
    .story-link {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
    }
    .story-link:hover {
      text-decoration: underline;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }
    .badge.sent {
      background: #d1fae5;
      color: #065f46;
    }
    .badge.pending {
      background: #fef3c7;
      color: #92400e;
    }
    .topics {
      color: #6b7280;
      font-size: 13px;
    }
    .feedback-cell {
      min-width: 140px;
    }
    .feedback-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .feedback-btn {
      padding: 6px 10px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.2s;
      background: #f3f4f6;
    }
    .feedback-btn:hover {
      transform: scale(1.1);
    }
    .feedback-btn.approve:hover {
      background: #d1fae5;
    }
    .feedback-btn.reject:hover {
      background: #fee2e2;
    }
    .feedback-btn.irrelevant:hover {
      background: #fef3c7;
    }
    .feedback-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .feedback-status {
      font-size: 13px;
      color: #6b7280;
    }
    .feedback-status.has-feedback {
      color: #059669;
      font-weight: 500;
    }
    .pagination {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      background: #f9fafb;
      border-top: 1px solid #e5e7eb;
    }
    .pagination-info {
      color: #6b7280;
      font-size: 14px;
    }
    .pagination-buttons {
      display: flex;
      gap: 8px;
    }
    .pagination-buttons a, .pagination-buttons span {
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
    }
    .pagination-buttons a {
      background: #667eea;
      color: #fff;
      transition: background 0.2s;
    }
    .pagination-buttons a:hover {
      background: #5a67d8;
    }
    .pagination-buttons span.disabled {
      background: #e5e7eb;
      color: #9ca3af;
      cursor: not-allowed;
    }
    .status-message {
      padding: 12px 20px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 14px;
      display: none;
    }
    .status-message.success {
      background: #d1fae5;
      color: #065f46;
    }
    .status-message.error {
      background: #fee2e2;
      color: #991b1b;
    }
    .status-message.info {
      background: #dbeafe;
      color: #1e40af;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #6b7280;
    }
    .empty-state h3 {
      margin: 0 0 8px 0;
      color: #374151;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📰 HN Insights Dashboard</h1>
      <div class="header-actions">
        <button id="fetchBtn" class="btn btn-primary" onclick="triggerFetch()">🔄 Trigger Fetch</button>
      </div>
    </div>

    <div id="statusMessage" class="status-message"></div>

    <div class="card">
      <form class="filters" method="GET" action="/">
        <div class="filter-group">
          <label for="search">Search</label>
          <input type="text" id="search" name="search" placeholder="Search titles..." value="${escapeHtml(search)}">
        </div>
        <div class="filter-group">
          <label for="notificationSent">Status</label>
          <select id="notificationSent" name="notificationSent">
            <option value="">All</option>
            <option value="true" ${notificationSent === 'true' ? 'selected' : ''}>Sent</option>
            <option value="false" ${notificationSent === 'false' ? 'selected' : ''}>Pending</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="sortBy">Sort By</label>
          <select id="sortBy" name="sortBy">
            <option value="firstSeenAt" ${sortBy === 'firstSeenAt' ? 'selected' : ''}>First Seen</option>
            <option value="score" ${sortBy === 'score' ? 'selected' : ''}>HN Score</option>
            <option value="relevanceScore" ${sortBy === 'relevanceScore' ? 'selected' : ''}>Relevance</option>
            <option value="date" ${sortBy === 'date' ? 'selected' : ''}>Date</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="sortOrder">Order</label>
          <select id="sortOrder" name="sortOrder">
            <option value="desc" ${sortOrder === 'desc' ? 'selected' : ''}>Descending</option>
            <option value="asc" ${sortOrder === 'asc' ? 'selected' : ''}>Ascending</option>
          </select>
        </div>
        <div class="filter-group" style="justify-content: flex-end;">
          <label>&nbsp;</label>
          <button type="submit" class="btn btn-primary">Apply Filters</button>
        </div>
      </form>

      <div class="table-wrapper">
        ${
          stories.length > 0
            ? `
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>HN Score</th>
              <th>Relevance</th>
              <th>Status</th>
              <th>Topics</th>
              <th>First Seen</th>
              <th>Feedback</th>
            </tr>
          </thead>
          <tbody>
            ${storyRows}
          </tbody>
        </table>
        `
            : `
        <div class="empty-state">
          <h3>No stories found</h3>
          <p>Try adjusting your filters or trigger a new fetch.</p>
        </div>
        `
        }
      </div>

      <div class="pagination">
        <div class="pagination-info">
          Showing ${stories.length} of ${total} stories (Page ${page} of ${totalPages || 1})
        </div>
        <div class="pagination-buttons">
          ${page > 1 ? `<a href="${buildUrl(page - 1)}">← Previous</a>` : `<span class="disabled">← Previous</span>`}
          ${page < totalPages ? `<a href="${buildUrl(page + 1)}">Next →</a>` : `<span class="disabled">Next →</span>`}
        </div>
      </div>
    </div>
  </div>

  <script>
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

    async function submitFeedback(storyId, action) {
      const statusEl = document.getElementById('statusMessage');
      const row = document.querySelector(\`tr[data-story-id="\${storyId}"]\`);
      const feedbackCell = row?.querySelector('.feedback-cell');
      
      if (!feedbackCell) return;
      
      const originalContent = feedbackCell.innerHTML;
      feedbackCell.innerHTML = '<span class="feedback-status">⏳ Saving...</span>';
      
      try {
        const response = await fetch('/api/submit-feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyId, action })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          feedbackCell.innerHTML = \`<span class="feedback-status has-feedback" title="\${action}">✓ \${action}</span>\`;
          statusEl.style.display = 'block';
          statusEl.className = 'status-message success';
          statusEl.textContent = \`Feedback saved: \${action}\`;
          setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
        } else {
          throw new Error(data.message || 'Failed to save feedback');
        }
      } catch (error) {
        feedbackCell.innerHTML = originalContent;
        statusEl.style.display = 'block';
        statusEl.className = 'status-message error';
        statusEl.textContent = 'Error: ' + error.message;
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
      }
    }
  </script>
</body>
</html>`;
}

export function renderResponse(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HN Insights</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; background:#f9fafb; color:#111827; }
    .card { max-width: 420px; margin: 0 auto; background:#fff; border-radius: 12px; padding: 20px; box-shadow: 0 6px 18px rgba(0,0,0,0.08); }
    h1 { font-size: 20px; margin: 0 0 8px 0; }
    p { margin: 0; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>HN Insights</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
