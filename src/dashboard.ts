import { getPrismaClient } from './prismaClient';

interface StoriesQueryParams {
  page: number;
  limit: number;
  notificationSent?: boolean | null;
  search?: string;
  sortBy?: 'date' | 'score' | 'relevanceScore' | 'firstSeenAt';
  sortOrder?: 'asc' | 'desc';
  rating?: string | null; // "unrated", "useful", "skip", "bookmark", "all"
  sources?: string[]; // Filter by source IDs
  topics?: string[]; // Filter by topic names
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
  rating: string | null;
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
  availableSources: string[];
  availableTopics: string[];
}

function extractSourceFromStoryId(storyId: string): string {
  // Story IDs are in format "source:id" or "source_variant:id"
  const match = storyId.match(/^([^:]+):/);
  return match ? match[1] : 'unknown';
}

export async function getStoriesPaginated(params: StoriesQueryParams): Promise<PaginatedResult> {
  const prisma = getPrismaClient();
  const { 
    page, 
    limit, 
    notificationSent, 
    search, 
    sortBy = 'firstSeenAt', 
    sortOrder = 'desc',
    rating,
    sources = [],
    topics = []
  } = params;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  
  if (notificationSent !== null && notificationSent !== undefined) {
    where.notificationSent = notificationSent;
  }
  
  if (search) {
    where.title = { contains: search };
  }

  // Rating filter
  if (rating && rating !== 'all') {
    if (rating === 'unrated') {
      where.rating = null;
    } else if (['useful', 'skip', 'bookmark'].includes(rating)) {
      where.rating = rating;
    }
  }

  // Source filter - need to filter by story ID pattern
  if (sources.length > 0) {
    // We'll filter in-memory after the query since Prisma doesn't support regex on IDs easily
  }

  // Topic filter
  if (topics.length > 0) {
    where.storyTopics = {
      some: {
        topic: {
          name: { in: topics }
        }
      }
    };
  }

  let allStories = await prisma.story.findMany({
    where,
    orderBy: { [sortBy]: sortOrder },
    select: {
      id: true,
      title: true,
      url: true,
      score: true,
      rank: true,
      date: true,
      reason: true,
      relevanceScore: true,
      rating: true,
      notificationSent: true,
      firstSeenAt: true,
      lastNotifiedAt: true,
      suppressedUntil: true,
      storyTopics: {
        include: { topic: true }
      },
      feedbackEvents: { 
        select: { action: true, createdAt: true }, 
        orderBy: { createdAt: 'desc' }, 
        take: 5 
      },
    },
  });

  // Post-filter for sources if needed
  if (sources.length > 0) {
    allStories = allStories.filter(story => {
      const storySource = extractSourceFromStoryId(story.id);
      return sources.includes(storySource);
    });
  }

  const total = allStories.length;
  const stories = allStories.slice(skip, skip + limit);

  // Get available sources and topics for filter dropdowns
  const allStoriesForMetadata = await prisma.story.findMany({
    select: { id: true },
  });
  const availableSources = Array.from(new Set(
    allStoriesForMetadata.map(s => extractSourceFromStoryId(s.id))
  )).sort();

  const allTopics = await prisma.topic.findMany({
    select: { name: true },
    orderBy: { score: 'desc' },
    take: 50, // Limit to top 50 topics
  });
  const availableTopics = allTopics.map(t => t.name);

  return {
    stories,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    availableSources,
    availableTopics,
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
  filters: { 
    notificationSent: string; 
    search: string; 
    sortBy: string; 
    sortOrder: string;
    rating: string;
    sources: string[];
    topics: string[];
  }
): string {
  const { stories, total, page, totalPages, availableSources, availableTopics } = data;
  const { notificationSent, search, sortBy, sortOrder, rating, sources, topics } = filters;

  const buildUrl = (newPage: number) => {
    const params = new URLSearchParams();
    params.set('page', String(newPage));
    if (notificationSent) params.set('notificationSent', notificationSent);
    if (search) params.set('search', search);
    if (sortBy) params.set('sortBy', sortBy);
    if (sortOrder) params.set('sortOrder', sortOrder);
    if (rating) params.set('rating', rating);
    sources.forEach(s => params.append('sources', s));
    topics.forEach(t => params.append('topics', t));
    return `/?${params.toString()}`;
  };

  const storyRows = stories
    .map((story) => {
      const storyTopics = story.storyTopics.map((st) => st.topic.name);
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
      
      // Match reason display
      const matchReason = story.reason 
        ? `<span class="match-reason" title="${escapeHtml(story.reason)}">${escapeHtml(story.reason.substring(0, 80))}${story.reason.length > 80 ? '...' : ''}</span>`
        : '-';

      // Check if feedback exists
      const hasFeedback = story.feedbackEvents.length > 0;
      const feedbackActions = story.feedbackEvents.map((fe) => fe.action).join(', ');

      const ratingButtons = !story.rating
        ? `<div class="rating-actions">
            <button class="rating-btn useful" onclick="submitRating('${story.id}', 'useful')" title="Useful">✓</button>
            <button class="rating-btn skip" onclick="submitRating('${story.id}', 'skip')" title="Skip">✗</button>
            <button class="rating-btn bookmark" onclick="submitRating('${story.id}', 'bookmark')" title="Bookmark">⭐</button>
          </div>`
        : `<span class="rating-set">${story.rating}</span>`;

      // TLDR button (only show if story has URL)
      const tldrButton = story.url 
        ? `<button class="tldr-btn" onclick="generateTLDR('${story.id}')" title="Generate TLDR">📄 TLDR</button>`
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
    })
    .join('');

  // Build source filter chips
  const sourceChips = availableSources.map(src => {
    const isSelected = sources.includes(src);
    const className = isSelected ? 'chip chip-selected' : 'chip';
    return `<button class="${className}" onclick="toggleFilter('sources', '${src}')">${escapeHtml(src)}</button>`;
  }).join('');

  // Build topic filter chips (show top 20)
  const topicChips = availableTopics.slice(0, 20).map(topic => {
    const isSelected = topics.includes(topic);
    const className = isSelected ? 'chip chip-selected' : 'chip';
    return `<button class="${className}" onclick="toggleFilter('topics', '${escapeHtml(topic)}')">${escapeHtml(topic)}</button>`;
  }).join('');

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
      max-width: 1600px;
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
      margin-bottom: 20px;
    }
    .filters {
      padding: 20px 24px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }
    .filter-row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 16px;
    }
    .filter-row:last-child {
      margin-bottom: 0;
    }
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .filter-group label {
      font-size: 12px;
      font-weight: 600;
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
    .chip-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .chip {
      padding: 6px 12px;
      border: 1px solid #d1d5db;
      border-radius: 20px;
      background: #fff;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .chip:hover {
      border-color: #667eea;
      background: #f3f4f6;
    }
    .chip-selected {
      background: #667eea;
      color: #fff;
      border-color: #667eea;
    }
    .chip-selected:hover {
      background: #5a67d8;
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
    td.center {
      text-align: center;
    }
    th {
      background: #f9fafb;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6b7280;
    }
    tr.unrated {
      background: #fffbeb;
    }
    tr.rated {
      opacity: 0.7;
    }
    tr:hover {
      background: #f9fafb;
      opacity: 1;
    }
    .story-link {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
      font-size: 15px;
    }
    .story-link:hover {
      text-decoration: underline;
    }
    .story-meta {
      display: flex;
      gap: 8px;
      margin-top: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    .source-tag {
      display: inline-block;
      padding: 2px 8px;
      background: #e0e7ff;
      color: #4338ca;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .topics-inline {
      color: #6b7280;
      font-size: 12px;
    }
    .match-reason-row {
      margin-top: 6px;
    }
    .match-reason {
      color: #059669;
      font-size: 12px;
      font-style: italic;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge.sent {
      background: #d1fae5;
      color: #065f46;
    }
    .badge.pending {
      background: #fef3c7;
      color: #92400e;
    }
    .badge.unrated {
      background: #fef3c7;
      color: #92400e;
      font-weight: 700;
    }
    .badge.rating-useful {
      background: #d1fae5;
      color: #065f46;
    }
    .badge.rating-skip {
      background: #fee2e2;
      color: #991b1b;
    }
    .badge.rating-bookmark {
      background: #dbeafe;
      color: #1e40af;
    }
    .rating-cell {
      min-width: 120px;
    }
    .rating-actions {
      display: flex;
      gap: 6px;
      align-items: center;
      justify-content: center;
    }
    .rating-btn {
      padding: 6px 12px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      transition: all 0.2s;
      background: #f3f4f6;
      font-weight: bold;
    }
    .rating-btn:hover {
      transform: scale(1.1);
    }
    .rating-btn.useful:hover {
      background: #d1fae5;
      color: #065f46;
    }
    .rating-btn.skip:hover {
      background: #fee2e2;
      color: #991b1b;
    }
    .rating-btn.bookmark:hover {
      background: #fef3c7;
      color: #92400e;
    }
    .rating-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .rating-set {
      font-size: 13px;
      color: #6b7280;
      font-weight: 500;
    }
    .tldr-btn {
      padding: 4px 10px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #fff;
      color: #374151;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .tldr-btn:hover {
      background: #f3f4f6;
      border-color: #667eea;
    }
    .tldr-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .modal {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      overflow-y: auto;
      padding: 20px;
    }
    .modal.show {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .modal-content {
      background: #fff;
      border-radius: 16px;
      max-width: 800px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      position: relative;
    }
    .modal-header {
      padding: 24px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f9fafb;
      border-radius: 16px 16px 0 0;
    }
    .modal-header h2 {
      margin: 0;
      font-size: 20px;
      color: #111827;
    }
    .modal-close {
      background: none;
      border: none;
      font-size: 28px;
      cursor: pointer;
      color: #6b7280;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      transition: all 0.2s;
    }
    .modal-close:hover {
      background: #e5e7eb;
      color: #111827;
    }
    .modal-body {
      padding: 24px;
    }
    .tldr-content {
      line-height: 1.8;
      color: #374151;
      font-size: 15px;
    }
    .tldr-content ul {
      margin: 16px 0;
      padding-left: 24px;
    }
    .tldr-content li {
      margin-bottom: 12px;
    }
    .tldr-loading {
      text-align: center;
      padding: 40px 20px;
      color: #6b7280;
    }
    .tldr-loading .spinner {
      display: inline-block;
      width: 40px;
      height: 40px;
      border: 4px solid #e5e7eb;
      border-top-color: #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .tldr-meta {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      font-size: 12px;
      color: #6b7280;
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
    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      margin: 16px 0 8px 0;
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
      <form class="filters" method="GET" action="/" id="filterForm">
        <div class="filter-row">
          <div class="filter-group">
            <label for="search">Search</label>
            <input type="text" id="search" name="search" placeholder="Search titles..." value="${escapeHtml(search)}">
          </div>
          <div class="filter-group">
            <label for="rating">Review Status</label>
            <select id="rating" name="rating">
              <option value="unrated" ${rating === 'unrated' || !rating ? 'selected' : ''}>Unrated (Default)</option>
              <option value="all" ${rating === 'all' ? 'selected' : ''}>All</option>
              <option value="useful" ${rating === 'useful' ? 'selected' : ''}>Useful</option>
              <option value="skip" ${rating === 'skip' ? 'selected' : ''}>Skip</option>
              <option value="bookmark" ${rating === 'bookmark' ? 'selected' : ''}>Bookmark</option>
            </select>
          </div>
          <div class="filter-group">
            <label for="notificationSent">Notification</label>
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
        </div>

        ${availableSources.length > 0 ? `
        <div class="section-title">Filter by Source</div>
        <div class="chip-container">
          ${sourceChips}
        </div>
        ` : ''}

        ${availableTopics.length > 0 ? `
        <div class="section-title">Filter by Topic (Top 20)</div>
        <div class="chip-container">
          ${topicChips}
        </div>
        ` : ''}

        <input type="hidden" id="sourcesInput" name="sources" value="">
        <input type="hidden" id="topicsInput" name="topics" value="">
      </form>

      <div class="table-wrapper">
        ${
          stories.length > 0
            ? `
        <table>
          <thead>
            <tr>
              <th>Title & Metadata</th>
              <th class="center">Score</th>
              <th class="center">Rating</th>
              <th class="center">Status</th>
              <th class="center">First Seen</th>
              <th class="center">Actions</th>
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

  <!-- TLDR Modal -->
  <div id="tldrModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2>📄 TLDR Summary</h2>
        <button class="modal-close" onclick="closeTLDRModal()">&times;</button>
      </div>
      <div class="modal-body" id="tldrModalBody">
        <div class="tldr-loading">
          <div class="spinner"></div>
          <p>Generating TLDR summary...</p>
          <p style="font-size: 12px; margin-top: 8px;">This may take 10-30 seconds</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Initialize filter state from URL
    const urlParams = new URLSearchParams(window.location.search);
    const selectedSources = urlParams.getAll('sources');
    const selectedTopics = urlParams.getAll('topics');
    
    // Set hidden inputs
    document.getElementById('sourcesInput').value = selectedSources.join(',');
    document.getElementById('topicsInput').value = selectedTopics.join(',');

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
      
      // Update URL and reload
      const form = document.getElementById('filterForm');
      form.submit();
    }

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

    async function submitRating(storyId, rating) {
      const statusEl = document.getElementById('statusMessage');
      const row = document.querySelector(\`tr[data-story-id="\${storyId}"]\`);
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
          ratingCell.innerHTML = \`<span class="rating-set">\${rating}</span>\`;
          row.classList.remove('unrated');
          row.classList.add('rated');
          statusEl.style.display = 'block';
          statusEl.className = 'status-message success';
          statusEl.textContent = \`Rating saved: \${rating}\`;
          setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
        } else {
          throw new Error(data.message || 'Failed to save rating');
        }
      } catch (error) {
        ratingCell.innerHTML = originalContent;
        statusEl.style.display = 'block';
        statusEl.className = 'status-message error';
        statusEl.textContent = 'Error: ' + error.message;
        setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
      }
    }

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

    async function generateTLDR(storyId) {
      const modal = document.getElementById('tldrModal');
      const modalBody = document.getElementById('tldrModalBody');
      const statusEl = document.getElementById('statusMessage');
      
      // Show modal with loading state
      modal.classList.add('show');
      modalBody.innerHTML = \`
        <div class="tldr-loading">
          <div class="spinner"></div>
          <p>Generating TLDR summary...</p>
          <p style="font-size: 12px; margin-top: 8px;">This may take 10-30 seconds</p>
        </div>
      \`;
      
      try {
        const response = await fetch('/api/generate-tldr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storyId })
        });
        
        const data = await response.json();
        
        if (response.ok && data.tldr) {
          // Format TLDR content (convert to HTML)
          const tldrHtml = data.tldr
            .split('\\n')
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
            ? '<ul>' + tldrHtml.replace(/<\\/p>|<p>/g, '') + '</ul>'
            : tldrHtml;
          
          const metaInfo = data.cached 
            ? '<p style="color: #059669;">✓ Cached result</p>'
            : \`<p>Generated with \${data.model || 'qwen3:1.7b'}</p>
               <p>Content length: ~\${Math.round((data.contentLength || 0) / 1000)}K characters</p>\`;
          
          modalBody.innerHTML = \`
            <div class="tldr-content">
              \${wrappedHtml}
            </div>
            <div class="tldr-meta">
              \${metaInfo}
            </div>
          \`;
        } else {
          throw new Error(data.message || 'Failed to generate TLDR');
        }
      } catch (error) {
        modalBody.innerHTML = \`
          <div style="text-align: center; padding: 40px 20px; color: #991b1b;">
            <p style="font-size: 18px; margin-bottom: 8px;">⚠️ Error</p>
            <p>\${error.message}</p>
          </div>
        \`;
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
