import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, orderBy, query, increment, getDocs } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBAPs7d59vZFkw2RSLUesnudcrZnNhxEdg",
  authDomain: "sharelink-54e34.firebaseapp.com",
  projectId: "sharelink-54e34",
  storageBucket: "sharelink-54e34.firebasestorage.app",
  messagingSenderId: "694782332637",
  appId: "1:694782332637:web:c4bbacb2b0fe34509e1534"
};

// ========== NOTICE POPUP ==========
(function() {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const noticeDate = '2026-04-17';
  const hidden = localStorage.getItem('noticeHidden_0417');
  if (today === noticeDate && hidden !== today) {
    document.getElementById('noticeBg').classList.add('open');
  }
})();

window.closeNotice = function() {
  if (document.getElementById('noticeNoToday').checked) {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    localStorage.setItem('noticeHidden_0417', today);
  }
  document.getElementById('noticeBg').classList.remove('open');
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
const colRef = collection(db, "links");

let links = [];
let authorFilter = '';
let selectedTags = new Set();
let selectedModalTags = new Set();
let fetchTimer = null;
let editId = null;
let pendingMeta = {};
let currentDetailLink = null;
let detailCommentUnsub = null;

// 실시간 동기화
const q = query(colRef, orderBy("createdAt", "desc"));
onSnapshot(q, (snapshot) => {
  links = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  document.getElementById('status').style.display = 'none';
  document.getElementById('grid').style.display = 'grid';
  render();
  if (currentDetailLink) {
    const updated = links.find(l => l.id === currentDetailLink.id);
    if (updated) { currentDetailLink = updated; renderDetailStats(); }
  }
}, (err) => {
  document.getElementById('status').textContent = 'Firebase 연결 실패. config를 확인해주세요.';
  console.error(err);
});

function getDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
}

function getSiteEmoji(url) {
  const d = getDomain(url);
  if (d.includes('youtube') || d.includes('youtu.be')) return '▶️';
  if (d.includes('instagram')) return '📸';
  if (d.includes('notion')) return '📄';
  if (d.includes('twitter') || d.includes('x.com')) return '𝕏';
  if (d.includes('github')) return '🐙';
  if (d.includes('figma')) return '🎨';
  return '🔗';
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getLikedSet() {
  try { return new Set(JSON.parse(localStorage.getItem('likedLinks') || '[]')); } catch { return new Set(); }
}

function setLiked(id, liked) {
  const s = getLikedSet();
  if (liked) s.add(id); else s.delete(id);
  localStorage.setItem('likedLinks', JSON.stringify([...s]));
}

// ========== RENDER CARDS ==========
function render() {
  const searchQ = document.getElementById('searchInput').value.toLowerCase();
  const grid = document.getElementById('grid');
  const sortOrder = document.getElementById('sortSelect').value;
  const sorted = [...links].sort((a, b) => {
    if (sortOrder === 'asc') return a.createdAt - b.createdAt;
    if (sortOrder === 'likes') return (b.likes || 0) - (a.likes || 0);
    if (sortOrder === 'comments') return (b.commentCount || 0) - (a.commentCount || 0);
    return b.createdAt - a.createdAt;
  });

  // 작성자 필터 배지 업데이트
  const badge = document.getElementById('authorFilterBadge');
  if (authorFilter) {
    badge.style.display = 'inline-flex';
    badge.querySelector('span').textContent = `작성자: ${authorFilter}`;
  } else {
    badge.style.display = 'none';
  }

  let filtered = sorted.filter(l => {
    const linkTags = Array.isArray(l.tags) ? l.tags : (l.tag ? [l.tag] : []);
    const matchTag = selectedTags.size === 0 || linkTags.some(t => selectedTags.has(t));
    const matchQ = !searchQ || (l.title||'').toLowerCase().includes(searchQ) || (l.url||'').toLowerCase().includes(searchQ);
    const matchAuthor = !authorFilter || (l.author || '') === authorFilter;
    return matchTag && matchQ && matchAuthor;
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty">링크가 없어요. 추가해보세요!</div>';
    return;
  }

  grid.innerHTML = filtered.map(l => {
    const thumbUrl = (l.images && l.images.length > 0) ? l.images[0] : l.image;
    const fallbackEmoji = l.url ? getSiteEmoji(l.url) : '💬';
    const thumb = thumbUrl
      ? `<img class="card-thumb" src="${escHtml(thumbUrl)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy">
         <div class="card-thumb-placeholder" style="display:none">${fallbackEmoji}</div>`
      : `<div class="card-thumb-placeholder">${fallbackEmoji}</div>`;

    const tags = Array.isArray(l.tags) ? l.tags : (l.tag ? [l.tag] : ['기타']);

    const isNew = l.createdAt && (Date.now() - l.createdAt) < 2 * 24 * 60 * 60 * 1000;
    return `
    <div class="card" onclick="window._openDetail('${l.id}')">
      ${isNew ? '<span class="new-badge">✦ NEW</span>' : ''}
      ${thumb}
      <div class="card-body">
        <div class="card-title">${escHtml(l.title || (l.url ? getDomain(l.url) : '제목 없음'))}</div>
        <div class="card-url">${l.url ? escHtml(getDomain(l.url)) : ''}</div>
        <div class="card-desc">${escHtml(l.desc || l.promptIntro || '')}</div>
        <div class="card-bottom">
        <div class="card-footer">
          <div class="card-tags">${tags.map(t => `<span class="card-tag">${escHtml(t)}</span>`).join('')}</div>
        </div>
        <div style="font-size:10px;color:#99aabb;margin-top:4px;min-height:1.4em;display:flex;align-items:center;justify-content:space-between;">
          <span>${l.author ? `<span style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px" onclick="event.stopPropagation();window._filterByAuthor(${escHtml(JSON.stringify(l.author))})">by ${escHtml(l.author)}</span>` : ''}</span>
          <div class="card-actions" onclick="event.stopPropagation()">
            <button onclick="window._editLink('${l.id}')">수정</button>
            <button class="del-btn" onclick="window._deleteLink('${l.id}')">삭제</button>
          </div>
        </div>
        <div class="card-meta">
          <span class="eye-icon"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3C4.5 3 1.5 8 1.5 8C1.5 8 4.5 13 8 13C11.5 13 14.5 8 14.5 8C14.5 8 11.5 3 8 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg> ${l.views || 0}</span>
          <span>♥ ${l.likes || 0}</span>
          <span>💬 ${l.commentCount || 0}</span>
          ${l.createdAt ? `<span class="card-meta-date">${new Date(l.createdAt).toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric'})}</span>` : ''}
        </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ========== DETAIL MODAL ==========
let carouselIndex = 0;

window._openDetail = async function(id) {
  const l = links.find(x => x.id === id);
  if (!l) return;
  currentDetailLink = l;

  // 조회수 증가
  updateDoc(doc(db, "links", id), { views: increment(1) });

  // 썸네일 / 캐러셀
  const thumbWrap = document.getElementById('detailThumbWrap');
  const images = (l.images && l.images.length > 0) ? l.images : (l.image ? [l.image] : []);
  carouselIndex = 0;

  if (images.length > 1) {
    thumbWrap.innerHTML = `
      <div class="carousel">
        <div class="carousel-slides">
          ${images.map((img, i) => `
            <div class="carousel-slide ${i === 0 ? 'active' : ''}">
              <img src="${escHtml(img)}" alt="">
            </div>`).join('')}
        </div>
        <button class="carousel-btn prev" onclick="event.stopPropagation();window._carouselPrev()">&#8249;</button>
        <button class="carousel-btn next" onclick="event.stopPropagation();window._carouselNext()">&#8250;</button>
        <div class="carousel-dots">
          ${images.map((_, i) => `<button class="carousel-dot ${i === 0 ? 'active' : ''}" onclick="event.stopPropagation();window._carouselGo(${i})"></button>`).join('')}
        </div>
      </div>`;
    thumbWrap.onclick = null;
    thumbWrap.style.cursor = 'default';
  } else if (images.length === 1) {
    thumbWrap.innerHTML = `<img src="${escHtml(images[0])}" alt="">
      ${l.url ? '<div class="detail-thumb-overlay"><span>사이트 방문 →</span></div>' : ''}`;
    thumbWrap.onclick = l.url ? () => window.open(l.url, '_blank', 'noopener') : null;
    thumbWrap.style.cursor = l.url ? 'pointer' : 'default';
  } else {
    const fallback = l.url ? getSiteEmoji(l.url) : '💬';
    thumbWrap.innerHTML = `<div class="detail-thumb-placeholder">${fallback}</div>
      ${l.url ? '<div class="detail-thumb-overlay"><span>사이트 방문 →</span></div>' : ''}`;
    thumbWrap.onclick = l.url ? () => window.open(l.url, '_blank', 'noopener') : null;
    thumbWrap.style.cursor = l.url ? 'pointer' : 'default';
  }

  // 태그
  const tags = Array.isArray(l.tags) ? l.tags : (l.tag ? [l.tag] : ['기타']);
  document.getElementById('detailTags').innerHTML = tags.map(t => `<span class="detail-tag">${escHtml(t)}</span>`).join('');

  // 제목
  document.getElementById('detailTitle').textContent = l.title || getDomain(l.url);

  // 메타
  const metaParts = [];
  if (l.author) metaParts.push(`👤 ${escHtml(l.author)}`);
  if (l.createdAt) metaParts.push(`📅 ${new Date(l.createdAt).toLocaleDateString('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit'})}`);
  if (l.url) metaParts.push(`🔗 ${escHtml(getDomain(l.url))}`);
  document.getElementById('detailMeta').innerHTML = metaParts.map(p => `<span>${p}</span>`).join('');

  // 설명
  document.getElementById('detailDesc').textContent = l.desc || '';

  // 통계
  renderDetailStats();

  // 프롬프트 섹션
  const body = document.getElementById('detailBody');
  if (tags.includes('프롬프트') && (l.promptIntro || l.promptEnv || l.promptText || l.promptTip)) {
    let html = '';
    if (l.promptIntro) html += `
      <div class="detail-section">
        <div class="detail-section-title">프롬프트 소개</div>
        <div class="detail-section-content">${escHtml(l.promptIntro)}</div>
      </div>`;
    if (l.promptEnv) html += `
      <div class="detail-section">
        <div class="detail-section-title">실행환경</div>
        <div class="detail-section-content">${escHtml(l.promptEnv)}</div>
      </div>`;
    if (l.promptText) html += `
      <div class="detail-section">
        <div class="detail-section-title">
          <span>프롬프트</span>
          <button class="copy-btn" id="copyPromptBtn" onclick="window._copyPrompt()">복사하기</button>
        </div>
        <div class="detail-section-content">${escHtml(l.promptText)}</div>
      </div>`;
    if (l.promptTip) html += `
      <div class="detail-section">
        <div class="detail-section-title">활용 팁</div>
        <div class="detail-section-content">${escHtml(l.promptTip)}</div>
      </div>`;
    body.innerHTML = html;
    body.style.display = 'block';
  } else {
    body.innerHTML = '';
    body.style.display = 'none';
  }

  // 댓글 실시간 구독
  if (detailCommentUnsub) detailCommentUnsub();
  const commentsRef = collection(db, "links", id, "comments");
  const cq = query(commentsRef, orderBy("createdAt", "asc"));
  detailCommentUnsub = onSnapshot(cq, (snap) => {
    renderComments(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });

  document.getElementById('detailBg').classList.add('open');
};

function renderDetailStats() {
  if (!currentDetailLink) return;
  const l = currentDetailLink;
  const liked = getLikedSet().has(l.id);
  document.getElementById('detailStats').innerHTML = `
    <button class="like-btn ${liked ? 'liked' : ''}" id="likeBtn" onclick="window._toggleLike()">
      ${liked ? '♥' : '♡'} 좋아요 ${l.likes || 0}
    </button>
    <span class="stat-item eye-icon"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3C4.5 3 1.5 8 1.5 8C1.5 8 4.5 13 8 13C11.5 13 14.5 8 14.5 8C14.5 8 11.5 3 8 3Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.4"/></svg> 조회수 ${l.views || 0}</span>
  `;
}

window._toggleLike = async function() {
  if (!currentDetailLink) return;
  const id = currentDetailLink.id;
  const liked = getLikedSet().has(id);
  setLiked(id, !liked);
  await updateDoc(doc(db, "links", id), { likes: increment(liked ? -1 : 1) });
};

window._copyPrompt = function() {
  if (!currentDetailLink || !currentDetailLink.promptText) return;
  navigator.clipboard.writeText(currentDetailLink.promptText).then(() => {
    const btn = document.getElementById('copyPromptBtn');
    if (btn) {
      btn.textContent = '복사됨!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '복사하기'; btn.classList.remove('copied'); }, 2000);
    }
  });
};

function renderComments(comments) {
  const list = document.getElementById('commentsList');
  if (!comments.length) {
    list.innerHTML = '<div style="color:#444;font-size:13px;padding:4px 0 12px">첫 댓글을 남겨보세요!</div>';
    return;
  }
  list.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-avatar">${(c.author || '?')[0].toUpperCase()}</div>
      <div class="comment-content">
        <div class="comment-author">${escHtml(c.author || '익명')}</div>
        <div class="comment-text">${escHtml(c.text)}</div>
        <div class="comment-date">${c.createdAt ? new Date(c.createdAt).toLocaleString('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : ''}</div>
      </div>
    </div>`).join('');
}

window.submitComment = async function() {
  if (!currentDetailLink) return;
  const author = document.getElementById('commentAuthor').value.trim() || '익명';
  const text = document.getElementById('commentText').value.trim();
  if (!text) return;
  const commentsRef = collection(db, "links", currentDetailLink.id, "comments");
  try {
    await addDoc(commentsRef, { author, text, createdAt: Date.now() });
    await updateDoc(doc(db, "links", currentDetailLink.id), { commentCount: increment(1) });
    document.getElementById('commentText').value = '';
  } catch(e) {
    alert('댓글 등록 실패: ' + e.message);
  }
};

window.closeDetail = function() {
  document.getElementById('detailBg').classList.remove('open');
  if (detailCommentUnsub) { detailCommentUnsub(); detailCommentUnsub = null; }
  currentDetailLink = null;
};

document.getElementById('detailBg').addEventListener('click', e => {
  if (e.target === document.getElementById('detailBg')) window.closeDetail();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('detailBg').classList.contains('open')) window.closeDetail();
    else if (document.getElementById('promptModalBg').classList.contains('open')) window.closePromptModal();
    else window.closeModal();
  }
});

// ========== TAG FILTERS ==========
document.querySelectorAll('.tag-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tag === '전체') {
      selectedTags.clear();
      document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    } else {
      document.querySelector('.tag-btn[data-tag="전체"]').classList.remove('active');
      if (selectedTags.has(btn.dataset.tag)) {
        selectedTags.delete(btn.dataset.tag);
        btn.classList.remove('active');
      } else {
        selectedTags.add(btn.dataset.tag);
        btn.classList.add('active');
      }
      if (selectedTags.size === 0) {
        document.querySelector('.tag-btn[data-tag="전체"]').classList.add('active');
      }
    }
    render();
  });
});

document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('sortSelect').addEventListener('change', render);

// ========== ADD/EDIT MODAL ==========
function updatePromptFields() {
  document.getElementById('promptFields').classList.toggle('visible', selectedModalTags.has('프롬프트'));
}

document.querySelectorAll('.modal-tag').forEach(btn => {
  btn.addEventListener('click', () => {
    if (selectedModalTags.has(btn.dataset.tag)) {
      selectedModalTags.delete(btn.dataset.tag);
      btn.classList.remove('selected');
    } else {
      selectedModalTags.add(btn.dataset.tag);
      btn.classList.add('selected');
    }
    updatePromptFields();
  });
});

window.openModal = function(id) {
  editId = id || null;
  pendingMeta = {};
  document.getElementById('modalTitle').textContent = id ? '링크 수정' : '링크 추가';
  document.getElementById('modalBg').classList.add('open');

  if (id) {
    const l = links.find(x => x.id === id);
    if (!l) { window.closeModal(); return; }
    document.getElementById('urlInput').value = l.url;
    document.getElementById('titleInput').value = l.title;
    document.getElementById('descInput').value = l.desc || '';
    document.getElementById('authorInput').value = l.author || '';
    document.getElementById('promptIntroInput').value = l.promptIntro || '';
    document.getElementById('promptEnvInput').value = l.promptEnv || '';
    document.getElementById('promptTextInput').value = l.promptText || '';
    document.getElementById('promptTipInput').value = l.promptTip || '';
    const existingTags = Array.isArray(l.tags) ? l.tags : (l.tag ? [l.tag] : []);
    selectedModalTags = new Set(existingTags);
    pendingMeta = { image: l.image };
  } else {
    ['urlInput','titleInput','descInput','authorInput','promptIntroInput','promptEnvInput','promptTextInput','promptTipInput'].forEach(id => {
      document.getElementById(id).value = '';
    });
    selectedModalTags = new Set();
  }

  document.querySelectorAll('.modal-tag').forEach(b => {
    b.classList.toggle('selected', selectedModalTags.has(b.dataset.tag));
  });
  updatePromptFields();
};

window.closeModal = function() {
  document.getElementById('modalBg').classList.remove('open');
  clearTimeout(fetchTimer);
};

let mousedownTarget = null;
document.getElementById('modalBg').addEventListener('mousedown', e => { mousedownTarget = e.target; });

window.handleBgClick = function(e) {
  if (e.target === document.getElementById('modalBg') && mousedownTarget === document.getElementById('modalBg')) {
    window.closeModal();
  }
};

window.onUrlChange = function() {
  clearTimeout(fetchTimer);
  const url = document.getElementById('urlInput').value.trim();
  if (!url || !url.startsWith('http')) return;
  fetchTimer = setTimeout(() => fetchMeta(url), 800);
};

async function fetchMeta(url) {
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.textContent = '불러오는 중...';
  saveBtn.disabled = true;
  try {
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (data.status === 'success') {
      pendingMeta = {
        title: data.data.title || '',
        image: data.data.image?.url || data.data.screenshot?.url || ''
      };
      const titleInput = document.getElementById('titleInput');
      if (!titleInput.value) titleInput.value = pendingMeta.title;
    }
  } catch(e) {}
  saveBtn.textContent = '저장';
  saveBtn.disabled = false;
}

window.saveLink = async function() {
  const url = document.getElementById('urlInput').value.trim();
  const title = document.getElementById('titleInput').value.trim() || getDomain(url);
  const desc = document.getElementById('descInput').value.trim();
  const author = document.getElementById('authorInput').value.trim();
  const tags = [...selectedModalTags];
  if (!url && !tags.includes('프롬프트')) return;

  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  const data = { url, title, desc, author, tags, image: pendingMeta.image || '' };

  if (tags.includes('프롬프트')) {
    data.promptIntro = document.getElementById('promptIntroInput').value.trim();
    data.promptEnv = document.getElementById('promptEnvInput').value.trim();
    data.promptText = document.getElementById('promptTextInput').value.trim();
    data.promptTip = document.getElementById('promptTipInput').value.trim();
  }

  try {
    if (editId) {
      await updateDoc(doc(db, "links", editId), data);
    } else {
      await addDoc(colRef, { ...data, createdAt: Date.now(), views: 0, likes: 0, commentCount: 0 });
    }
    window.closeModal();
  } catch(e) {
    alert('저장 실패: ' + e.message);
  }

  saveBtn.disabled = false;
  saveBtn.textContent = '저장';
};

window._editLink = function(id) { window.openModal(id); };

window._filterByAuthor = function(author) {
  authorFilter = author;
  render();
};

window._clearAuthorFilter = function() {
  authorFilter = '';
  render();
};

window._deleteLink = async function(id) {
  if (!confirm('삭제할까요?')) return;
  try {
    const commentsSnap = await getDocs(collection(db, "links", id, "comments"));
    await Promise.all(commentsSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "links", id));
  } catch(e) {
    alert('삭제 실패: ' + e.message);
  }
};

// ========== CAROUSEL ==========
window._carouselPrev = function() {
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.carousel-dot');
  if (!slides.length) return;
  slides[carouselIndex].classList.remove('active');
  dots[carouselIndex].classList.remove('active');
  carouselIndex = (carouselIndex - 1 + slides.length) % slides.length;
  slides[carouselIndex].classList.add('active');
  dots[carouselIndex].classList.add('active');
};

window._carouselNext = function() {
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.carousel-dot');
  if (!slides.length) return;
  slides[carouselIndex].classList.remove('active');
  dots[carouselIndex].classList.remove('active');
  carouselIndex = (carouselIndex + 1) % slides.length;
  slides[carouselIndex].classList.add('active');
  dots[carouselIndex].classList.add('active');
};

window._carouselGo = function(i) {
  const slides = document.querySelectorAll('.carousel-slide');
  const dots = document.querySelectorAll('.carousel-dot');
  if (!slides.length) return;
  slides[carouselIndex].classList.remove('active');
  dots[carouselIndex].classList.remove('active');
  carouselIndex = i;
  slides[carouselIndex].classList.add('active');
  dots[carouselIndex].classList.add('active');
};

// ========== PROMPT MODAL ==========
let selectedPromptModalTags = new Set(['프롬프트']);
let selectedImageFiles = [];

document.querySelectorAll('#promptModalTagsContainer .modal-tag').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tag === '프롬프트') return;
    if (selectedPromptModalTags.has(btn.dataset.tag)) {
      selectedPromptModalTags.delete(btn.dataset.tag);
      btn.classList.remove('selected');
    } else {
      selectedPromptModalTags.add(btn.dataset.tag);
      btn.classList.add('selected');
    }
  });
});

window.openPromptModal = function() {
  selectedPromptModalTags = new Set(['프롬프트']);
  selectedImageFiles = [];
  ['pTitleInput','pAuthorInput','pPromptIntroInput','pPromptEnvInput','pPromptTextInput','pPromptTipInput'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('uploadPreview').innerHTML = '';
  document.querySelectorAll('#promptModalTagsContainer .modal-tag').forEach(b => {
    b.classList.toggle('selected', selectedPromptModalTags.has(b.dataset.tag));
  });
  document.getElementById('promptModalBg').classList.add('open');
};

window.closePromptModal = function() {
  document.getElementById('promptModalBg').classList.remove('open');
};

window.handlePromptBgClick = function(e) {
  if (e.target === document.getElementById('promptModalBg')) window.closePromptModal();
};

window.handleImageSelect = function(e) {
  selectedImageFiles = [...selectedImageFiles, ...[...e.target.files]];
  e.target.value = '';
  renderUploadPreview();
};

function renderUploadPreview() {
  const preview = document.getElementById('uploadPreview');
  if (!selectedImageFiles.length) { preview.innerHTML = ''; return; }
  preview.innerHTML = selectedImageFiles.map((f, i) => `
    <div class="upload-thumb">
      <img src="${URL.createObjectURL(f)}" alt="">
      <button onclick="window._removeImage(${i})">✕</button>
    </div>`).join('');
}

window._removeImage = function(i) {
  selectedImageFiles.splice(i, 1);
  renderUploadPreview();
};

// 이미지를 압축해서 Blob으로 반환
async function compressToBlob(file, maxPx, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => {
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('이미지 압축 실패'));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error(`"${file.name}" 이미지를 읽을 수 없습니다 (HEIC/지원하지 않는 형식)`));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error(`"${file.name}" 파일 읽기 실패`));
    reader.readAsDataURL(file);
  });
}

window.savePrompt = async function() {
  const title = document.getElementById('pTitleInput').value.trim();
  if (!title) { alert('제목을 입력해주세요'); return; }

  const btn = document.getElementById('pSaveBtn');
  btn.disabled = true;
  btn.textContent = selectedImageFiles.length > 0 ? '업로드 중...' : '저장 중...';

  try {
    const imageUrls = [];
    for (let i = 0; i < selectedImageFiles.length; i++) {
      const file = selectedImageFiles[i];
      if (selectedImageFiles.length > 1) {
        btn.textContent = `업로드 중... (${i + 1}/${selectedImageFiles.length})`;
      }
      const blob = await compressToBlob(file, 1200, 0.82);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileRef = storageRef(storage, `prompts/${Date.now()}_${safeName}`);
      const snapshot = await uploadBytes(fileRef, blob);
      const url = await getDownloadURL(snapshot.ref);
      imageUrls.push(url);
    }

    const tags = [...selectedPromptModalTags];
    await addDoc(colRef, {
      title,
      author: document.getElementById('pAuthorInput').value.trim(),
      tags,
      images: imageUrls,
      promptIntro: document.getElementById('pPromptIntroInput').value.trim(),
      promptEnv: document.getElementById('pPromptEnvInput').value.trim(),
      promptText: document.getElementById('pPromptTextInput').value.trim(),
      promptTip: document.getElementById('pPromptTipInput').value.trim(),
      createdAt: Date.now(),
      views: 0,
      likes: 0,
      commentCount: 0
    });
    window.closePromptModal();
  } catch(e) {
    alert('저장 실패: ' + e.message);
    btn.disabled = false;
    btn.textContent = '저장';
    return;
  }

  btn.disabled = false;
  btn.textContent = '저장';
};
