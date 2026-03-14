import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  collection, addDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp, getDocs, updateDoc, increment,
  limit, startAfter, getCountFromServer,
  type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import type { BoardPost, BoardComment } from '../../types/board';

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function drawingCount(json: string): number {
  try {
    const obj = JSON.parse(json);
    return Object.values(obj).reduce<number>((s, arr) => s + (arr as unknown[]).length, 0);
  } catch { return 0; }
}

function mapPost(d: QueryDocumentSnapshot<DocumentData>): BoardPost {
  return {
    id:           d.id,
    author:       d.data().author as string,
    title:        d.data().title as string,
    content:      (d.data().content as string) ?? '',
    tickers:      d.data().tickers as string[],
    drawingsJson: d.data().drawingsJson as string,
    createdAt:    (d.data().createdAt?.toMillis?.() ?? Date.now()) as number,
    updatedAt:    d.data().updatedAt?.toMillis?.() as number | undefined,
    commentCount: (d.data().commentCount as number) ?? 0,
    views:        (d.data().views as number) ?? 0,
    likes:        (d.data().likes as number) ?? 0,
    dislikes:     (d.data().dislikes as number) ?? 0,
  };
}

// ── Vote helpers (localStorage) ────────────────────────────────────────────────

function getVotes(): Record<string, 'like' | 'dislike'> {
  try { return JSON.parse(localStorage.getItem('board_votes') ?? '{}') as Record<string, 'like' | 'dislike'>; }
  catch { return {}; }
}
function saveVotes(v: Record<string, 'like' | 'dislike'>) {
  try { localStorage.setItem('board_votes', JSON.stringify(v)); } catch {}
}

// ── View helpers (sessionStorage — one increment per browser session) ──────────

function getViewedPosts(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem('board_viewed') ?? '[]') as string[]); }
  catch { return new Set(); }
}

// ── Sub-component: Comments section ──────────────────────────────────────────

function CommentSection({ postId, currentUser }: { postId: string; currentUser: string }) {
  const [comments, setComments]       = useState<BoardComment[]>([]);
  const [text, setText]               = useState('');
  const [submitting, setSubmitting]   = useState(false);
  // edit state
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editText, setEditText]       = useState('');
  const [editSaving, setEditSaving]   = useState(false);
  // delete confirm
  const [deleteId, setDeleteId]       = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'board_posts', postId, 'comments'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, snap => {
      setComments(snap.docs.map(d => ({
        id:        d.id,
        author:    d.data().author as string,
        text:      d.data().text as string,
        createdAt: (d.data().createdAt?.toMillis?.() ?? Date.now()) as number,
        updatedAt: d.data().updatedAt?.toMillis?.() as number | undefined,
      })));
    });
  }, [postId]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'board_posts', postId, 'comments'), {
        author: currentUser, text: trimmed, createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'board_posts', postId), { commentCount: increment(1) });
      setText('');
    } finally {
      setSubmitting(false);
    }
  }, [text, submitting, postId, currentUser]);

  const startEdit = (c: BoardComment) => { setEditingId(c.id); setEditText(c.text); };
  const cancelEdit = () => { setEditingId(null); setEditText(''); };

  const saveEdit = useCallback(async () => {
    if (!editingId || !editText.trim() || editSaving) return;
    setEditSaving(true);
    try {
      await updateDoc(doc(db, 'board_posts', postId, 'comments', editingId), {
        text: editText.trim(), updatedAt: serverTimestamp(),
      });
      cancelEdit();
    } finally {
      setEditSaving(false);
    }
  }, [editingId, editText, editSaving, postId]);

  const handleDelete = useCallback(async (commentId: string) => {
    setDeleteId(null);
    await deleteDoc(doc(db, 'board_posts', postId, 'comments', commentId));
    await updateDoc(doc(db, 'board_posts', postId), { commentCount: increment(-1) });
  }, [postId]);

  return (
    <div style={cs.wrap}>
      {comments.length > 0 && (
        <div style={cs.list}>
          {comments.map(c => (
            <div key={c.id} style={cs.comment}>
              {editingId === c.id ? (
                /* ── Inline edit row ── */
                <div style={cs.editRow}>
                  <input
                    style={cs.editInput}
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                      if (e.key === 'Escape') cancelEdit();
                    }}
                    maxLength={300}
                    autoFocus
                  />
                  <button
                    style={{ ...cs.editSaveBtn, opacity: (!editText.trim() || editSaving) ? 0.4 : 1 }}
                    onClick={saveEdit}
                    disabled={!editText.trim() || editSaving}
                  >{editSaving ? '저장 중' : '저장'}</button>
                  <button style={cs.editCancelBtn} onClick={cancelEdit}>취소</button>
                </div>
              ) : deleteId === c.id ? (
                /* ── Delete confirm row ── */
                <div style={cs.deleteConfirmRow}>
                  <span style={cs.deleteConfirmMsg}>이 댓글을 삭제하시겠습니까?</span>
                  <button style={cs.deleteConfirmBtn} onClick={() => handleDelete(c.id)}>삭제</button>
                  <button style={cs.editCancelBtn} onClick={() => setDeleteId(null)}>취소</button>
                </div>
              ) : (
                /* ── Normal view ── */
                <>
                  <span style={cs.commentAuthor}>👤 {c.author}</span>
                  <span style={cs.commentText}>{c.text}</span>
                  <div style={cs.commentMeta}>
                    <span style={cs.commentDate}>{formatDate(c.createdAt)}</span>
                    {c.updatedAt && <span style={cs.commentEdited}>(수정됨)</span>}
                  </div>
                  {c.author === currentUser && (
                    <div style={cs.commentOwnerBtns}>
                      <button style={cs.commentEditBtn} onClick={() => startEdit(c)}>수정</button>
                      <button style={cs.commentDeleteBtn} onClick={() => setDeleteId(c.id)}>삭제</button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={cs.inputRow}>
        <input
          style={cs.input}
          placeholder="댓글을 입력하세요..."
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          maxLength={300}
        />
        <button
          style={{ ...cs.sendBtn, opacity: (!text.trim() || submitting) ? 0.4 : 1 }}
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
        >
          등록
        </button>
      </div>
    </div>
  );
}

const cs: Record<string, React.CSSProperties> = {
  wrap:             { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 },
  list:             { display: 'flex', flexDirection: 'column', gap: 6 },
  comment:          { display: 'flex', alignItems: 'baseline', gap: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 5, padding: '7px 10px', flexWrap: 'wrap' },
  commentAuthor:    { color: '#5e6673', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 },
  commentText:      { color: '#c0c4cc', fontSize: '0.82rem', flex: 1, lineHeight: 1.5, minWidth: 0 },
  commentMeta:      { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 },
  commentDate:      { color: '#3a4558', fontSize: '0.68rem', fontFamily: 'monospace' },
  commentEdited:    { color: '#3a4558', fontSize: '0.65rem', fontStyle: 'italic' },
  commentOwnerBtns: { display: 'flex', gap: 4, flexShrink: 0, marginLeft: 2 },
  commentEditBtn:   { background: 'none', border: '1px solid rgba(59,139,235,0.25)', borderRadius: 3, color: '#4a88d0', cursor: 'pointer', fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', fontFamily: 'inherit', opacity: 0.75 },
  commentDeleteBtn: { background: 'none', border: '1px solid rgba(246,70,93,0.25)', borderRadius: 3, color: '#f6465d', cursor: 'pointer', fontSize: '0.65rem', fontWeight: 600, padding: '1px 6px', fontFamily: 'inherit', opacity: 0.7 },
  // edit inline
  editRow:          { display: 'flex', alignItems: 'center', gap: 6, width: '100%', flexWrap: 'wrap' },
  editInput:        { flex: 1, minWidth: 120, background: '#0d1520', border: '1px solid #3a4870', borderRadius: 4, color: '#d1d4dc', fontSize: '0.82rem', padding: '5px 8px', outline: 'none', fontFamily: 'inherit' },
  editSaveBtn:      { background: '#2a3550', border: '1px solid #3a4870', borderRadius: 4, color: '#7aa2e0', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '4px 12px', fontFamily: 'inherit', flexShrink: 0 },
  editCancelBtn:    { background: 'none', border: '1px solid #2a3040', borderRadius: 4, color: '#5e6673', cursor: 'pointer', fontSize: '0.75rem', padding: '4px 10px', fontFamily: 'inherit', flexShrink: 0 },
  // delete confirm inline
  deleteConfirmRow: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', flexWrap: 'wrap' },
  deleteConfirmMsg: { color: '#f6465d', fontSize: '0.78rem', flex: 1 },
  deleteConfirmBtn: { background: 'rgba(246,70,93,0.12)', border: '1px solid rgba(246,70,93,0.4)', borderRadius: 4, color: '#f6465d', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, padding: '4px 12px', fontFamily: 'inherit', flexShrink: 0 },
  // input row
  inputRow:         { display: 'flex', gap: 8 },
  input:            { flex: 1, background: '#0d1520', border: '1px solid #2a2e39', borderRadius: 5, color: '#d1d4dc', fontSize: '0.85rem', padding: '7px 10px', outline: 'none', fontFamily: 'inherit' },
  sendBtn:          { background: '#2a3550', border: '1px solid #3a4870', borderRadius: 5, color: '#7aa2e0', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, padding: '7px 16px', fontFamily: 'inherit', flexShrink: 0 },
};

// ── Sub-component: Confirm dialog ─────────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel }: {
  message: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={dg.overlay}>
      <div style={dg.box}>
        <div style={dg.icon}>⚠️</div>
        <div style={dg.message}>{message}</div>
        <div style={dg.btnRow}>
          <button style={dg.cancelBtn} onClick={onCancel}>취소</button>
          <button style={dg.confirmBtn} onClick={onConfirm}>삭제</button>
        </div>
      </div>
    </div>
  );
}

const dg: Record<string, React.CSSProperties> = {
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9500 },
  box:        { background: '#1e222d', border: '1px solid #3a4558', borderRadius: 10, padding: '28px 32px', width: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  icon:       { fontSize: '2rem' },
  message:    { color: '#d1d4dc', fontSize: '0.92rem', textAlign: 'center', lineHeight: 1.6, whiteSpace: 'pre-line' },
  btnRow:     { display: 'flex', gap: 10, marginTop: 4 },
  cancelBtn:  { flex: 1, background: 'none', border: '1px solid #3a4558', borderRadius: 5, color: '#848e9c', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, padding: '9px 20px', fontFamily: 'inherit' },
  confirmBtn: { flex: 1, background: 'rgba(246,70,93,0.15)', border: '1px solid rgba(246,70,93,0.4)', borderRadius: 5, color: '#f6465d', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 700, padding: '9px 20px', fontFamily: 'inherit' },
};

// ── Main Board Modal ──────────────────────────────────────────────────────────

interface Props {
  currentUser: string;
  onImport: (drawingsJson: string) => void;
  onClose: () => void;
}

type View = 'list' | 'compose';

export function BoardModal({ currentUser, onImport, onClose }: Props) {
  const configured = isFirebaseConfigured();

  // ── View state
  const [view, setView] = useState<View>('list');

  // ── Post list state
  const [posts, setPosts]           = useState<BoardPost[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading]       = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]       = useState(false);
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const unsubRef   = useRef<(() => void) | null>(null);

  // ── Search
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // ── Compose form
  const [title, setTitle]           = useState('');
  const [content, setContent]       = useState('');
  const [parsed, setParsed]         = useState<{ tickers: string[]; json: string } | null>(null);
  const [fileError, setFileError]   = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ── Post interaction
  const [importedId, setImportedId]     = useState<string | null>(null);
  const [expandedId, setExpandedId]     = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BoardPost | null>(null);
  const [votes, setVotes]               = useState<Record<string, 'like' | 'dislike'>>(() => getVotes());

  // ── Inline edit
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editTitle, setEditTitle]     = useState('');
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving]   = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // Escape to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !confirmDelete) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, confirmDelete]);

  // ── Load first page (real-time via onSnapshot)
  const loadFirstPage = useCallback(() => {
    if (!configured) { setLoading(false); return; }

    // Detach previous listener
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }

    setLoading(true);
    lastDocRef.current = null;

    // Total count (for display)
    getCountFromServer(collection(db, 'board_posts'))
      .then(snap => setTotalCount(snap.data().count))
      .catch(() => {});

    const q = query(
      collection(db, 'board_posts'),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
    );
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs;
      setPosts(docs.map(mapPost));
      lastDocRef.current = docs[docs.length - 1] ?? null;
      setHasMore(docs.length === PAGE_SIZE);
      setLoading(false);
    }, () => setLoading(false));

    unsubRef.current = unsub;
  }, [configured]);

  useEffect(() => {
    loadFirstPage();
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [loadFirstPage]);

  // ── Load more (cursor pagination)
  const loadMore = useCallback(async () => {
    if (!lastDocRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const q = query(
        collection(db, 'board_posts'),
        orderBy('createdAt', 'desc'),
        startAfter(lastDocRef.current),
        limit(PAGE_SIZE),
      );
      const snap = await getDocs(q);
      const newPosts = snap.docs.map(mapPost);
      setPosts(prev => {
        // Deduplicate by id
        const ids = new Set(prev.map(p => p.id));
        return [...prev, ...newPosts.filter(p => !ids.has(p.id))];
      });
      lastDocRef.current = snap.docs[snap.docs.length - 1] ?? null;
      setHasMore(snap.docs.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  // ── Client-side search filter
  const filteredPosts = searchTerm.trim()
    ? posts.filter(p => {
        const kw = searchTerm.toLowerCase();
        return (
          p.title.toLowerCase().includes(kw) ||
          p.content.toLowerCase().includes(kw) ||
          p.author.toLowerCase().includes(kw) ||
          p.tickers.some(t => t.toLowerCase().includes(kw))
        );
      })
    : posts;

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSearchTerm(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput('');
    setSearchTerm('');
  };

  // ── File parsing
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null); setParsed(null);
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const obj = JSON.parse(ev.target?.result as string);
        if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('올바른 도형 JSON 파일이 아닙니다');
        const tickers = Object.keys(obj).filter(k => Array.isArray(obj[k]) && obj[k].length > 0);
        if (tickers.length === 0) throw new Error('도형이 없습니다');
        setParsed({ tickers, json: JSON.stringify(obj) });
      } catch (err) {
        setFileError(err instanceof Error ? err.message : '유효하지 않은 파일입니다');
      }
    };
    reader.readAsText(f);
    e.target.value = '';
  };

  // ── Submit new post
  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !parsed || submitting) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'board_posts'), {
        author: currentUser, title: title.trim(), content: content.trim(),
        tickers: parsed.tickers, drawingsJson: parsed.json,
        createdAt: serverTimestamp(), commentCount: 0,
        views: 0, likes: 0, dislikes: 0,
      });
      setTotalCount(c => c + 1);
      setView('list'); setTitle(''); setContent(''); setParsed(null);
    } finally {
      setSubmitting(false);
    }
  }, [title, content, parsed, submitting, currentUser]);

  // ── Increment views for newly-loaded posts (once per browser session) ────────
  useEffect(() => {
    if (posts.length === 0) return;
    const viewed = getViewedPosts();
    const unviewed = posts.filter(p => !viewed.has(p.id));
    if (unviewed.length === 0) return;
    const next = new Set(viewed);
    unviewed.forEach(p => next.add(p.id));
    sessionStorage.setItem('board_viewed', JSON.stringify([...next]));
    unviewed.forEach(p => {
      updateDoc(doc(db, 'board_posts', p.id), { views: increment(1) }).catch(() => {});
    });
  }, [posts]);

  // ── Toggle comments ───────────────────────────────────────────────────────────
  const handleToggleComments = useCallback((postId: string) => {
    setExpandedId(prev => prev === postId ? null : postId);
  }, []);

  // ── Like / Dislike ─────────────────────────────────────────────────────────
  const handleVote = useCallback(async (post: BoardPost, action: 'like' | 'dislike') => {
    const current = votes[post.id];
    const newVotes = { ...votes };
    const updates: Record<string, unknown> = {};

    if (current === action) {
      // Toggle off
      delete newVotes[post.id];
      updates[action === 'like' ? 'likes' : 'dislikes'] = increment(-1);
    } else {
      // Switch or new vote
      if (current) {
        updates[current === 'like' ? 'likes' : 'dislikes'] = increment(-1);
      }
      newVotes[post.id] = action;
      updates[action === 'like' ? 'likes' : 'dislikes'] = increment(1);
    }

    setVotes(newVotes);
    saveVotes(newVotes);
    await updateDoc(doc(db, 'board_posts', post.id), updates);
  }, [votes]);

  const resetCompose = () => {
    setView('list'); setTitle(''); setContent(''); setParsed(null); setFileError(null);
  };

  // ── Delete
  const handleDeleteConfirmed = useCallback(async () => {
    if (!confirmDelete) return;
    const postId = confirmDelete.id;
    setConfirmDelete(null);
    const commSnap = await getDocs(collection(db, 'board_posts', postId, 'comments'));
    await Promise.all(commSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(db, 'board_posts', postId));
    setTotalCount(c => Math.max(0, c - 1));
  }, [confirmDelete]);

  // ── Import
  const handleImport = useCallback((post: BoardPost) => {
    onImport(post.drawingsJson);
    setImportedId(post.id);
    setTimeout(() => setImportedId(null), 2000);
  }, [onImport]);

  // ── Edit
  const startEdit = (post: BoardPost) => {
    setEditingId(post.id); setEditTitle(post.title); setEditContent(post.content);
  };
  const cancelEdit = () => { setEditingId(null); setEditTitle(''); setEditContent(''); };
  const saveEdit = useCallback(async () => {
    if (!editingId || !editTitle.trim() || editSaving) return;
    setEditSaving(true);
    try {
      await updateDoc(doc(db, 'board_posts', editingId), {
        title: editTitle.trim(), content: editContent.trim(), updatedAt: serverTimestamp(),
      });
      cancelEdit();
    } finally {
      setEditSaving(false);
    }
  }, [editingId, editTitle, editContent, editSaving]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div style={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div style={s.modal}>

          {/* ── Header ── */}
          <div style={s.header}>
            <div style={s.headerLeft}>
              <span style={s.headerTitle}>📋 도형 게시판</span>
              <span style={s.headerSub}>
                {totalCount > 0 ? `전체 ${totalCount.toLocaleString()}개 게시물 · ` : ''}
                로그인한 모든 사용자와 차트 도형을 공유합니다
              </span>
            </div>
            <div style={s.headerRight}>
              {view === 'list'
                ? <button style={s.composeBtn} onClick={() => setView('compose')}>+ 내 도형 공유하기</button>
                : <button style={s.cancelBtn} onClick={resetCompose}>← 목록으로</button>
              }
              <button style={s.closeBtn} onClick={onClose}>✕</button>
            </div>
          </div>

          {/* ── Firebase not configured ── */}
          {!configured && (
            <div style={s.configWarn}>
              ⚠ Firebase 설정이 없습니다. <code>.env</code> 파일에 <code>VITE_FIREBASE_*</code> 환경 변수를 추가하세요.
              <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer" style={s.configLink}>Firebase 콘솔 열기 →</a>
            </div>
          )}

          {/* ── Compose form ── */}
          {view === 'compose' && configured && (
            <div style={s.compose}>
              <div style={s.composeGrid}>
                <div style={s.field}>
                  <label style={s.label}>제목 *</label>
                  <input
                    style={s.input} type="text"
                    placeholder="예) BTC 주요 지지·저항 구간 분석"
                    value={title} onChange={e => setTitle(e.target.value)}
                    autoFocus maxLength={80}
                  />
                </div>
                <div style={s.field}>
                  <label style={s.label}>본문 내용</label>
                  <textarea
                    style={s.textarea}
                    placeholder="분석 내용, 주의사항, 사용 방법 등을 자유롭게 작성하세요..."
                    value={content} onChange={e => setContent(e.target.value)}
                    maxLength={2000} rows={5}
                  />
                  <span style={s.charCount}>{content.length} / 2000</span>
                </div>
                <div style={s.field}>
                  <label style={s.label}>도형 파일 (.json) *</label>
                  <div style={s.fileRow}>
                    <button style={s.filePickBtn} onClick={() => fileRef.current?.click()}>📁 파일 선택</button>
                    <span style={s.fileHint}>
                      {parsed
                        ? `✓ ${parsed.tickers.length}개 티커, ${drawingCount(parsed.json)}개 도형 인식됨`
                        : '우상단 내보내기로 저장한 JSON 파일을 선택하세요'}
                    </span>
                    <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleFile} />
                  </div>
                  {fileError && <div style={s.fileError}>{fileError}</div>}
                  {parsed && (
                    <div style={s.tickerPreview}>
                      {parsed.tickers.map(t => <span key={t} style={s.tickerTag}>{t}</span>)}
                    </div>
                  )}
                </div>
              </div>
              <button
                style={{ ...s.submitBtn, opacity: (!title.trim() || !parsed || submitting) ? 0.45 : 1 }}
                disabled={!title.trim() || !parsed || submitting}
                onClick={handleSubmit}
              >
                {submitting ? '게시 중...' : '게시하기'}
              </button>
            </div>
          )}

          {/* ── Search bar ── */}
          {view === 'list' && configured && (
            <div style={s.searchBar}>
              <form style={s.searchForm} onSubmit={handleSearch}>
                <span style={s.searchIcon}>🔍</span>
                <input
                  style={s.searchInput}
                  placeholder="제목, 내용, 작성자, 티커 검색..."
                  value={searchInput}
                  onChange={e => {
                    setSearchInput(e.target.value);
                    if (e.target.value === '') setSearchTerm('');
                  }}
                />
                {searchInput && (
                  <button type="button" style={s.clearBtn} onClick={clearSearch}>✕</button>
                )}
                <button type="submit" style={s.searchBtn}>검색</button>
              </form>
              {searchTerm && (
                <div style={s.searchMeta}>
                  <span style={s.searchResultText}>
                    "{searchTerm}" 검색결과: {filteredPosts.length}건
                    {hasMore ? ` (현재 ${posts.length}개 게시물 내 검색 · 더 보기로 범위 확장 가능)` : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Post list ── */}
          {view === 'list' && (
            <div style={s.listWrap}>
              {loading && <div style={s.centerMsg}>불러오는 중...</div>}

              {!loading && filteredPosts.length === 0 && (
                <div style={s.emptyWrap}>
                  <div style={s.emptyIcon}>{searchTerm ? '🔍' : '📂'}</div>
                  <div style={s.emptyTitle}>
                    {searchTerm ? `"${searchTerm}"에 해당하는 게시물이 없습니다` : '아직 공유된 도형이 없습니다'}
                  </div>
                  <div style={s.emptyHint}>
                    {searchTerm
                      ? '다른 검색어를 시도하거나 아래 "더 보기"로 더 많은 게시물을 불러오세요.'
                      : '상단 "+ 내 도형 공유하기" 버튼으로 첫 번째 게시물을 올려보세요.'}
                  </div>
                </div>
              )}

              {filteredPosts.map(post => (
                <div key={post.id} style={s.postCard}>
                  {editingId === post.id ? (
                    /* ── Inline Edit Mode ── */
                    <div style={s.editWrap}>
                      <div style={s.field}>
                        <label style={s.label}>제목</label>
                        <input style={s.input} value={editTitle} onChange={e => setEditTitle(e.target.value)} maxLength={80} autoFocus />
                      </div>
                      <div style={s.field}>
                        <label style={s.label}>본문 내용</label>
                        <textarea style={s.textarea} value={editContent} onChange={e => setEditContent(e.target.value)} maxLength={2000} rows={5} />
                        <span style={s.charCount}>{editContent.length} / 2000</span>
                      </div>
                      <div style={s.editBtnRow}>
                        <button style={s.editCancelBtn} onClick={cancelEdit}>취소</button>
                        <button
                          style={{ ...s.editSaveBtn, opacity: (!editTitle.trim() || editSaving) ? 0.5 : 1 }}
                          disabled={!editTitle.trim() || editSaving}
                          onClick={saveEdit}
                        >
                          {editSaving ? '저장 중...' : '저장'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Normal View ── */
                    <>
                      <div style={s.postHeader}>
                        <span style={s.postTitle}>{post.title}</span>
                        {post.author === currentUser && (
                          <div style={s.ownerBtns}>
                            <button style={s.editBtn} onClick={() => startEdit(post)}>✏ 수정</button>
                            <button style={s.deleteBtn} onClick={() => setConfirmDelete(post)}>🗑 삭제</button>
                          </div>
                        )}
                      </div>

                      <div style={s.tickerRow}>
                        {post.tickers.map(t => <span key={t} style={s.tickerTag}>{t}</span>)}
                      </div>

                      {post.content && (
                        <div style={s.postContent}>{post.content}</div>
                      )}

                      <div style={s.meta}>
                        <span style={s.metaAuthor}>👤 {post.author}</span>
                        <span style={s.metaSep}>·</span>
                        <span style={s.metaDate}>{formatDate(post.createdAt)}</span>
                        {post.updatedAt && (
                          <>
                            <span style={s.metaSep}>·</span>
                            <span style={s.metaEdited}>수정됨 {formatDate(post.updatedAt)}</span>
                          </>
                        )}
                        <span style={s.metaSep}>·</span>
                        <span style={s.metaInfo}>{post.tickers.length}개 티커 · {drawingCount(post.drawingsJson)}개 도형</span>
                        <span style={s.metaSep}>·</span>
                        <span style={s.metaViews}>조회 {post.views ?? 0}</span>
                      </div>

                      <div style={s.actions}>
                        <button
                          style={{ ...s.importBtn, ...(importedId === post.id ? s.importedBtn : {}) }}
                          onClick={() => handleImport(post)}
                        >
                          {importedId === post.id ? '✓ 가져옴!' : '↓ 내 차트에 가져오기'}
                        </button>
                        <button
                          style={{ ...s.likeBtn, ...(votes[post.id] === 'like' ? s.likedBtn : {}) }}
                          onClick={() => handleVote(post, 'like')}
                          title="추천"
                        >
                          👍 {post.likes ?? 0}
                        </button>
                        <button
                          style={{ ...s.dislikeBtn, ...(votes[post.id] === 'dislike' ? s.dislikedBtn : {}) }}
                          onClick={() => handleVote(post, 'dislike')}
                          title="비추천"
                        >
                          👎 {post.dislikes ?? 0}
                        </button>
                        <button style={s.commentToggleBtn} onClick={() => handleToggleComments(post.id)}>
                          💬 댓글 {post.commentCount > 0 ? `(${post.commentCount})` : ''} {expandedId === post.id ? '▲' : '▼'}
                        </button>
                      </div>

                      {expandedId === post.id && (
                        <div style={s.commentWrap}>
                          <CommentSection postId={post.id} currentUser={currentUser} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}

              {/* ── Load more / status ── */}
              {!loading && !searchTerm && (
                <div style={s.loadMoreWrap}>
                  {hasMore ? (
                    <button
                      style={{ ...s.loadMoreBtn, opacity: loadingMore ? 0.6 : 1 }}
                      onClick={loadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore ? '불러오는 중...' : `더 보기 (${posts.length} / ${totalCount})`}
                    </button>
                  ) : (
                    posts.length > 0 && (
                      <span style={s.allLoadedText}>
                        전체 {posts.length}개 게시물을 모두 불러왔습니다
                      </span>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message={`"${confirmDelete.title}" 게시물을 삭제하시겠습니까?\n댓글도 함께 삭제되며 복구할 수 없습니다.`}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 8000 },
  modal:   { background: '#131722', border: '1px solid #2a2e39', borderRadius: 12, width: 820, maxWidth: '97vw', height: '90vh', maxHeight: 900, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' },

  // header
  header:      { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid #2a2e39', flexShrink: 0, background: '#1e222d' },
  headerLeft:  { display: 'flex', flexDirection: 'column', gap: 2 },
  headerTitle: { color: '#d1d4dc', fontSize: '1.05rem', fontWeight: 700 },
  headerSub:   { color: '#3a4558', fontSize: '0.75rem' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10 },
  composeBtn:  { background: '#f0b90b', border: 'none', borderRadius: 5, color: '#1a1200', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, padding: '7px 16px', fontFamily: 'inherit' },
  cancelBtn:   { background: 'none', border: '1px solid #3a4558', borderRadius: 5, color: '#848e9c', cursor: 'pointer', fontSize: '0.85rem', padding: '7px 14px', fontFamily: 'inherit' },
  closeBtn:    { background: 'none', border: 'none', color: '#5e6673', cursor: 'pointer', fontSize: '1.1rem', padding: '4px 6px', lineHeight: 1 },

  // warning
  configWarn: { background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.2)', color: '#f6465d', fontSize: '0.82rem', padding: '12px 22px', lineHeight: 1.6, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' },
  configLink: { color: '#4a90d9', marginLeft: 'auto' },

  // search bar
  searchBar:        { padding: '12px 22px', borderBottom: '1px solid #2a2e39', flexShrink: 0, background: '#161a25', display: 'flex', flexDirection: 'column', gap: 6 },
  searchForm:       { display: 'flex', alignItems: 'center', gap: 8 },
  searchIcon:       { fontSize: '0.9rem', flexShrink: 0 },
  searchInput:      { flex: 1, background: '#0d1520', border: '1px solid #2a2e39', borderRadius: 5, color: '#d1d4dc', fontSize: '0.88rem', padding: '8px 10px', outline: 'none', fontFamily: 'inherit' },
  clearBtn:         { background: 'none', border: 'none', color: '#5e6673', cursor: 'pointer', fontSize: '0.8rem', padding: '4px 6px', lineHeight: 1 },
  searchBtn:        { background: '#2a3550', border: '1px solid #3a4870', borderRadius: 5, color: '#7aa2e0', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, padding: '8px 16px', fontFamily: 'inherit', flexShrink: 0 },
  searchMeta:       { display: 'flex', alignItems: 'center', gap: 8 },
  searchResultText: { color: '#4a5568', fontSize: '0.75rem' },

  // compose
  compose:      { padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', background: '#1a1e2d', borderBottom: '1px solid #2a2e39' },
  composeGrid:  { display: 'flex', flexDirection: 'column', gap: 14 },
  field:        { display: 'flex', flexDirection: 'column', gap: 6 },
  label:        { color: '#5e6673', fontSize: '0.77rem', fontWeight: 600, letterSpacing: '0.04em' },
  input:        { background: '#0d1520', border: '1px solid #2a2e39', borderRadius: 5, color: '#d1d4dc', fontSize: '0.92rem', padding: '10px 12px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const, width: '100%' },
  textarea:     { background: '#0d1520', border: '1px solid #2a2e39', borderRadius: 5, color: '#d1d4dc', fontSize: '0.9rem', padding: '10px 12px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const, width: '100%', resize: 'vertical' as const, lineHeight: 1.6, minHeight: 100 },
  charCount:    { color: '#3a4558', fontSize: '0.72rem', textAlign: 'right' as const },
  fileRow:      { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  filePickBtn:  { background: '#0d1520', border: '1px solid #2a2e39', borderRadius: 5, color: '#848e9c', cursor: 'pointer', fontSize: '0.85rem', padding: '8px 14px', fontFamily: 'inherit', flexShrink: 0 },
  fileHint:     { color: '#4a5568', fontSize: '0.8rem' },
  fileError:    { background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.25)', borderRadius: 4, color: '#f6465d', fontSize: '0.77rem', padding: '6px 10px' },
  tickerPreview:{ display: 'flex', flexWrap: 'wrap' as const, gap: 5 },
  submitBtn:    { background: '#f0b90b', border: 'none', borderRadius: 6, color: '#1a1200', cursor: 'pointer', fontSize: '0.95rem', fontWeight: 700, padding: '12px 32px', fontFamily: 'inherit', alignSelf: 'flex-start' as const },

  // list
  listWrap:  { flex: 1, overflowY: 'auto', padding: '16px 22px', display: 'flex', flexDirection: 'column', gap: 14 },
  centerMsg: { color: '#3a4558', fontSize: '0.88rem', textAlign: 'center', paddingTop: 40 },
  emptyWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '60px 0', color: '#3a4558', textAlign: 'center' },
  emptyIcon:  { fontSize: '2.5rem', marginBottom: 4 },
  emptyTitle: { color: '#4a5568', fontSize: '1rem', fontWeight: 600 },
  emptyHint:  { color: '#2a3040', fontSize: '0.8rem' },

  // post card
  postCard:    { background: '#1e222d', border: '1px solid #2a2e39', borderRadius: 8, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 },
  postHeader:  { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  postTitle:   { color: '#d1d4dc', fontSize: '1rem', fontWeight: 700, lineHeight: 1.4, flex: 1 },
  ownerBtns:   { display: 'flex', gap: 6, flexShrink: 0 },
  editBtn:     { background: 'none', border: '1px solid rgba(59,139,235,0.3)', borderRadius: 4, color: '#5a9fef', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', fontFamily: 'inherit', opacity: 0.8 },
  deleteBtn:   { background: 'none', border: '1px solid rgba(246,70,93,0.3)', borderRadius: 4, color: '#f6465d', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', fontFamily: 'inherit', opacity: 0.7 },
  postContent: { color: '#9098a8', fontSize: '0.88rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' as const, background: 'rgba(255,255,255,0.02)', borderRadius: 5, padding: '10px 12px', borderLeft: '2px solid #2a3550' },
  tickerRow:   { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  tickerTag:   { background: 'rgba(59,139,235,0.12)', border: '1px solid rgba(59,139,235,0.3)', borderRadius: 4, color: '#5a9fef', fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', fontFamily: '"SF Mono", Consolas, monospace' },
  meta:        { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },
  metaAuthor:  { color: '#5e6673', fontSize: '0.8rem', fontWeight: 600 },
  metaSep:     { color: '#2a3040', fontSize: '0.77rem' },
  metaDate:    { color: '#3a4558', fontSize: '0.77rem', fontFamily: 'monospace' },
  metaEdited:  { color: '#3a4558', fontSize: '0.72rem', fontStyle: 'italic' },
  metaInfo:    { color: '#3a4558', fontSize: '0.77rem' },
  metaViews:   { color: '#3a4558', fontSize: '0.77rem' },
  actions:     { display: 'flex', gap: 8, flexWrap: 'wrap' as const },
  importBtn:        { background: 'rgba(14,203,129,0.08)', border: '1px solid rgba(14,203,129,0.25)', borderRadius: 5, color: '#0ecb81', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, padding: '6px 16px', fontFamily: 'inherit', transition: 'all 0.15s' },
  importedBtn:      { background: 'rgba(14,203,129,0.2)', borderColor: '#0ecb81' },
  likeBtn:          { background: 'none', border: '1px solid #2a2e39', borderRadius: 5, color: '#5e6673', cursor: 'pointer', fontSize: '0.82rem', padding: '6px 12px', fontFamily: 'inherit', transition: 'all 0.15s' },
  likedBtn:         { background: 'rgba(14,203,129,0.12)', border: '1px solid rgba(14,203,129,0.4)', color: '#0ecb81' },
  dislikeBtn:       { background: 'none', border: '1px solid #2a2e39', borderRadius: 5, color: '#5e6673', cursor: 'pointer', fontSize: '0.82rem', padding: '6px 12px', fontFamily: 'inherit', transition: 'all 0.15s' },
  dislikedBtn:      { background: 'rgba(246,70,93,0.1)', border: '1px solid rgba(246,70,93,0.35)', color: '#f6465d' },
  commentToggleBtn: { background: 'none', border: '1px solid #2a2e39', borderRadius: 5, color: '#5e6673', cursor: 'pointer', fontSize: '0.82rem', padding: '6px 14px', fontFamily: 'inherit' },
  commentWrap:      { borderTop: '1px solid #2a2e39', paddingTop: 12, marginTop: 2 },

  // load more
  loadMoreWrap:  { display: 'flex', justifyContent: 'center', paddingTop: 4, paddingBottom: 8 },
  loadMoreBtn:   { background: 'none', border: '1px solid #2a2e39', borderRadius: 6, color: '#5e6673', cursor: 'pointer', fontSize: '0.85rem', padding: '10px 28px', fontFamily: 'inherit', transition: 'all 0.15s' },
  allLoadedText: { color: '#2a3040', fontSize: '0.78rem' },

  // inline edit
  editWrap:      { display: 'flex', flexDirection: 'column', gap: 12 },
  editBtnRow:    { display: 'flex', gap: 8, justifyContent: 'flex-end' as const },
  editCancelBtn: { background: 'none', border: '1px solid #3a4558', borderRadius: 5, color: '#848e9c', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, padding: '7px 18px', fontFamily: 'inherit' },
  editSaveBtn:   { background: '#f0b90b', border: 'none', borderRadius: 5, color: '#1a1200', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, padding: '7px 22px', fontFamily: 'inherit' },
};
