import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  collection, addDoc, deleteDoc, doc, onSnapshot,
  query, orderBy, serverTimestamp, updateDoc, increment,
  limit, startAfter, getCountFromServer,
  type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../lib/firebase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserPost {
  id: string;
  author: string;
  title: string;
  content: string;       // HTML content
  passwordHash: string;  // SHA-256 hex of password
  createdAt: number;
  updatedAt?: number;
  commentCount: number;
  pinned?: boolean;      // admin-pinned, always stays at top
}

interface UserComment {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;
const COLLECTION = 'user_board_posts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function mapPost(d: QueryDocumentSnapshot<DocumentData>): UserPost {
  return {
    id:           d.id,
    author:       d.data().author as string,
    title:        d.data().title as string,
    content:      (d.data().content as string) ?? '',
    passwordHash: (d.data().passwordHash as string) ?? '',
    createdAt:    (d.data().createdAt?.toMillis?.() ?? Date.now()) as number,
    updatedAt:    d.data().updatedAt?.toMillis?.() as number | undefined,
    commentCount: (d.data().commentCount as number) ?? 0,
    pinned:       (d.data().pinned as boolean) ?? false,
  };
}

function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent ?? tmp.innerText ?? '';
}

// ── Rich Text Editor ──────────────────────────────────────────────────────────

interface EditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

function RichTextEditor({ value, onChange, placeholder = '내용을 입력하세요...', minHeight = 200 }: EditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);

  // Sync external value → DOM only on mount / external reset
  const lastExternal = useRef('');
  useEffect(() => {
    if (!editorRef.current) return;
    if (value !== lastExternal.current) {
      lastExternal.current = value;
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value;
      }
    }
  }, [value]);

  const execCmd = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, val);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const handleInput = () => {
    if (!isComposing.current && editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const toolbarBtnStyle: React.CSSProperties = {
    background: 'none',
    border: '1px solid #3a3e4a',
    borderRadius: 3,
    color: '#c9d1d9',
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    padding: '2px 7px',
    lineHeight: '1.4',
  };

  return (
    <div style={{ border: '1px solid #3a3e4a', borderRadius: 4, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        background: '#1a1d27',
        borderBottom: '1px solid #3a3e4a',
        padding: '4px 8px',
        display: 'flex',
        gap: 4,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        <button style={{ ...toolbarBtnStyle, fontWeight: 900 }} onMouseDown={e => { e.preventDefault(); execCmd('bold'); }} title="굵게">B</button>
        <button style={{ ...toolbarBtnStyle, fontStyle: 'italic' }} onMouseDown={e => { e.preventDefault(); execCmd('italic'); }} title="기울임">I</button>
        <button style={{ ...toolbarBtnStyle, textDecoration: 'underline' }} onMouseDown={e => { e.preventDefault(); execCmd('underline'); }} title="밑줄">U</button>
        <button style={{ ...toolbarBtnStyle, textDecoration: 'line-through' }} onMouseDown={e => { e.preventDefault(); execCmd('strikeThrough'); }} title="취소선">S</button>
        <span style={{ color: '#444', margin: '0 2px' }}>|</span>
        <button style={toolbarBtnStyle} onMouseDown={e => { e.preventDefault(); execCmd('justifyLeft'); }} title="왼쪽 정렬">≡</button>
        <button style={toolbarBtnStyle} onMouseDown={e => { e.preventDefault(); execCmd('justifyCenter'); }} title="가운데 정렬">≡</button>
        <button style={toolbarBtnStyle} onMouseDown={e => { e.preventDefault(); execCmd('justifyRight'); }} title="오른쪽 정렬">≡</button>
        <span style={{ color: '#444', margin: '0 2px' }}>|</span>
        <button style={toolbarBtnStyle} onMouseDown={e => { e.preventDefault(); execCmd('insertUnorderedList'); }} title="순서 없는 목록">• 목록</button>
        <button style={toolbarBtnStyle} onMouseDown={e => { e.preventDefault(); execCmd('insertOrderedList'); }} title="순서 있는 목록">1. 목록</button>
        <span style={{ color: '#444', margin: '0 2px' }}>|</span>
        <select
          style={{ background: '#1a1d27', border: '1px solid #3a3e4a', borderRadius: 3, color: '#c9d1d9', fontSize: '0.8rem', padding: '2px 4px', cursor: 'pointer' }}
          defaultValue=""
          onChange={e => { execCmd('fontSize', e.target.value); e.target.value = ''; }}
          title="글자 크기"
        >
          <option value="" disabled>크기</option>
          <option value="1">작게</option>
          <option value="3">보통</option>
          <option value="5">크게</option>
          <option value="7">매우 크게</option>
        </select>
        <select
          style={{ background: '#1a1d27', border: '1px solid #3a3e4a', borderRadius: 3, color: '#c9d1d9', fontSize: '0.8rem', padding: '2px 4px', cursor: 'pointer' }}
          defaultValue=""
          onChange={e => { execCmd('foreColor', e.target.value); e.target.value = ''; }}
          title="글자 색상"
        >
          <option value="" disabled>색상</option>
          <option value="#ffffff" style={{ background: '#333' }}>흰색</option>
          <option value="#f6c90e">노란색</option>
          <option value="#ef5350">빨간색</option>
          <option value="#26c6da">파란색</option>
          <option value="#66bb6a">초록색</option>
          <option value="#ef9a9a">분홍색</option>
          <option value="#848e9c">회색</option>
        </select>
        <span style={{ color: '#444', margin: '0 2px' }}>|</span>
        <button style={toolbarBtnStyle} onMouseDown={e => { e.preventDefault(); execCmd('removeFormat'); }} title="서식 초기화">초기화</button>
      </div>
      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => {
          isComposing.current = false;
          if (editorRef.current) onChange(editorRef.current.innerHTML);
        }}
        data-placeholder={placeholder}
        style={{
          background: '#12151e',
          color: '#c9d1d9',
          minHeight,
          padding: '10px 12px',
          outline: 'none',
          lineHeight: 1.6,
          fontSize: '0.92rem',
          wordBreak: 'break-word',
        }}
      />
      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #4a5060;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

// ── Sub-component: Comments ───────────────────────────────────────────────────

function CommentSection({ postId, currentUser }: { postId: string; currentUser: string }) {
  const [comments, setComments] = useState<UserComment[]>([]);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, COLLECTION, postId, 'comments'),
      orderBy('createdAt', 'asc'),
    );
    return onSnapshot(q, snap => {
      setComments(snap.docs.map(d => ({
        id:        d.id,
        author:    d.data().author as string,
        text:      d.data().text as string,
        createdAt: (d.data().createdAt?.toMillis?.() ?? Date.now()) as number,
      })));
    });
  }, [postId]);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, COLLECTION, postId, 'comments'), {
        author: currentUser, text: trimmed, createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, COLLECTION, postId), { commentCount: increment(1) });
      setText('');
    } finally {
      setSubmitting(false);
    }
  }, [text, submitting, postId, currentUser]);

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #2a2e39', paddingTop: 10 }}>
      <div style={{ fontSize: '0.82rem', color: '#848e9c', marginBottom: 8 }}>댓글 {comments.length}개</div>
      {comments.map(c => (
        <div key={c.id} style={{ marginBottom: 8, fontSize: '0.85rem' }}>
          <span style={{ color: '#f6c90e', fontWeight: 600 }}>{c.author}</span>
          <span style={{ color: '#848e9c', marginLeft: 8, fontSize: '0.78rem' }}>{formatDate(c.createdAt)}</span>
          <div style={{ color: '#c9d1d9', marginTop: 2, paddingLeft: 4 }}>{c.text}</div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          placeholder="댓글을 입력하세요..."
          style={{ flex: 1, background: '#1a1d27', border: '1px solid #3a3e4a', borderRadius: 4, color: '#c9d1d9', fontSize: '0.85rem', padding: '5px 8px' }}
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          style={{ background: '#2962ff', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: '0.82rem', padding: '5px 12px', opacity: (!text.trim() || submitting) ? 0.5 : 1 }}
        >
          등록
        </button>
      </div>
    </div>
  );
}

// ── Sub-component: Password Dialog ────────────────────────────────────────────

interface PasswordDialogProps {
  title: string;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}

function PasswordDialog({ title, onConfirm, onCancel }: PasswordDialogProps) {
  const [pw, setPw] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 3000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#1e222d', border: '1px solid #3a3e4a', borderRadius: 8,
        padding: '24px 28px', minWidth: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
        <div style={{ color: '#c9d1d9', fontSize: '1rem', fontWeight: 600, marginBottom: 16 }}>{title}</div>
        <input
          ref={inputRef}
          type="password"
          value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(pw); if (e.key === 'Escape') onCancel(); }}
          placeholder="비밀번호 입력"
          style={{
            width: '100%', background: '#12151e', border: '1px solid #3a3e4a',
            borderRadius: 4, color: '#c9d1d9', fontSize: '0.9rem', padding: '8px 10px',
            boxSizing: 'border-box', marginBottom: 16,
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{ background: '#2a2e39', border: 'none', borderRadius: 4, color: '#c9d1d9', cursor: 'pointer', fontSize: '0.88rem', padding: '6px 16px' }}
          >
            취소
          </button>
          <button
            onClick={() => onConfirm(pw)}
            disabled={!pw}
            style={{ background: '#2962ff', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: '0.88rem', padding: '6px 16px', opacity: pw ? 1 : 0.5 }}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  currentUser: string;
  onClose: () => void;
}

type View = 'list' | 'compose' | 'edit';

export function UserBoardModal({ currentUser, onClose }: Props) {
  const configured = isFirebaseConfigured();

  const [view, setView] = useState<View>('list');

  // List state
  const [posts, setPosts] = useState<UserPost[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const lastDocRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // Search
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Expanded post
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Compose state
  const [composeTitle, setComposeTitle] = useState('');
  const [composeContent, setComposeContent] = useState('');
  const [composeAuthor, setComposeAuthor] = useState(currentUser);
  const [composePassword, setComposePassword] = useState('');
  const [composeConfirmPw, setComposeConfirmPw] = useState('');
  const [composeError, setComposeError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit state
  const [editPost, setEditPost] = useState<UserPost | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Password dialog
  const [pwDialog, setPwDialog] = useState<{
    mode: 'delete' | 'edit';
    post: UserPost;
  } | null>(null);

  // Escape to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pwDialog) { setPwDialog(null); return; }
        if (view !== 'list') { setView('list'); return; }
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, view, pwDialog]);

  // Load first page
  const loadFirstPage = useCallback(() => {
    if (!configured) { setLoading(false); return; }
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    setLoading(true);
    lastDocRef.current = null;

    getCountFromServer(collection(db, COLLECTION))
      .then(snap => setTotalCount(snap.data().count))
      .catch(() => {});

    const q = query(collection(db, COLLECTION), orderBy('createdAt', 'desc'), limit(PAGE_SIZE));
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs;
      setPosts(docs.map(mapPost));
      lastDocRef.current = docs[docs.length - 1] ?? null;
      setHasMore(docs.length === PAGE_SIZE);
      setLoading(false);
    });
    unsubRef.current = unsub;
  }, [configured]);

  useEffect(() => {
    loadFirstPage();
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!lastDocRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const q = query(
        collection(db, COLLECTION),
        orderBy('createdAt', 'desc'),
        startAfter(lastDocRef.current),
        limit(PAGE_SIZE),
      );
      const snap = await new Promise<{ docs: QueryDocumentSnapshot<DocumentData>[] }>((resolve, reject) => {
        const unsub = onSnapshot(q, snap => { unsub(); resolve(snap); }, reject);
      });
      const docs = snap.docs;
      setPosts(prev => [...prev, ...docs.map(mapPost)]);
      lastDocRef.current = docs[docs.length - 1] ?? lastDocRef.current;
      setHasMore(docs.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  // Filter by search, then sort: pinned first, then by createdAt desc
  const filtered = (searchTerm
    ? posts.filter(p => {
        const term = searchTerm.toLowerCase();
        return (
          p.title.toLowerCase().includes(term) ||
          stripHtml(p.content).toLowerCase().includes(term) ||
          p.author.toLowerCase().includes(term)
        );
      })
    : posts
  ).slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt - a.createdAt;
  });

  // Submit new post
  const handleSubmit = useCallback(async () => {
    if (!composeTitle.trim()) { setComposeError('제목을 입력하세요.'); return; }
    if (!stripHtml(composeContent).trim()) { setComposeError('내용을 입력하세요.'); return; }
    if (!composeAuthor.trim()) { setComposeError('작성자를 입력하세요.'); return; }
    if (!composePassword) { setComposeError('비밀번호를 입력하세요.'); return; }
    if (composePassword !== composeConfirmPw) { setComposeError('비밀번호가 일치하지 않습니다.'); return; }
    setComposeError('');
    setSubmitting(true);
    try {
      const passwordHash = await hashPassword(composePassword);
      const isAdmin = currentUser === 'root';
      await addDoc(collection(db, COLLECTION), {
        author: composeAuthor.trim(),
        title: composeTitle.trim(),
        content: composeContent,
        passwordHash,
        commentCount: 0,
        createdAt: serverTimestamp(),
        ...(isAdmin ? { pinned: true } : {}),
      });
      setComposeTitle('');
      setComposeContent('');
      setComposePassword('');
      setComposeConfirmPw('');
      setView('list');
      loadFirstPage();
    } catch (e) {
      setComposeError('게시글 등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }, [composeTitle, composeContent, composeAuthor, composePassword, composeConfirmPw, loadFirstPage]);

  // Open edit (with password verification)
  const handleEditRequest = useCallback((post: UserPost) => {
    setPwDialog({ mode: 'edit', post });
  }, []);

  // Open delete (with password verification)
  const handleDeleteRequest = useCallback((post: UserPost) => {
    setPwDialog({ mode: 'delete', post });
  }, []);

  const handlePasswordConfirm = useCallback(async (password: string) => {
    if (!pwDialog) return;
    const hash = await hashPassword(password);
    if (hash !== pwDialog.post.passwordHash) {
      alert('비밀번호가 일치하지 않습니다.');
      setPwDialog(null);
      return;
    }
    if (pwDialog.mode === 'delete') {
      try {
        await deleteDoc(doc(db, COLLECTION, pwDialog.post.id));
        setPosts(prev => prev.filter(p => p.id !== pwDialog.post.id));
        if (expandedId === pwDialog.post.id) setExpandedId(null);
      } catch {
        alert('삭제에 실패했습니다.');
      }
    } else {
      // edit mode
      setEditPost(pwDialog.post);
      setEditTitle(pwDialog.post.title);
      setEditContent(pwDialog.post.content);
      setEditError('');
      setView('edit');
    }
    setPwDialog(null);
  }, [pwDialog, expandedId]);

  const handleSaveEdit = useCallback(async () => {
    if (!editPost) return;
    if (!editTitle.trim()) { setEditError('제목을 입력하세요.'); return; }
    if (!stripHtml(editContent).trim()) { setEditError('내용을 입력하세요.'); return; }
    setEditError('');
    setEditSaving(true);
    try {
      await updateDoc(doc(db, COLLECTION, editPost.id), {
        title: editTitle.trim(),
        content: editContent,
        updatedAt: serverTimestamp(),
      });
      setView('list');
      setEditPost(null);
    } catch {
      setEditError('수정에 실패했습니다.');
    } finally {
      setEditSaving(false);
    }
  }, [editPost, editTitle, editContent]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        {/* Header */}
        <div style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {view !== 'list' && (
              <button onClick={() => setView('list')} style={s.backBtn}>← 목록</button>
            )}
            <span style={s.title}>
              💬 유저 게시판
              {view === 'list' && totalCount > 0 && (
                <span style={{ color: '#848e9c', fontSize: '0.82rem', marginLeft: 8 }}>({totalCount})</span>
              )}
              {view === 'compose' && <span style={{ color: '#848e9c', fontSize: '0.9rem', marginLeft: 8 }}>글쓰기</span>}
              {view === 'edit' && <span style={{ color: '#848e9c', fontSize: '0.9rem', marginLeft: 8 }}>수정</span>}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {view === 'list' && (
              <button onClick={() => { setComposeError(''); setView('compose'); }} style={s.composeBtn}>
                + 글쓰기
              </button>
            )}
            <button onClick={onClose} style={s.closeBtn}>✕</button>
          </div>
        </div>

        {/* Firebase not configured warning */}
        {!configured && (
          <div style={{ padding: '16px 20px', color: '#ef5350', fontSize: '0.88rem' }}>
            Firebase가 설정되지 않았습니다. .env 파일에 Firebase 설정을 추가하세요.
          </div>
        )}

        {/* ── List View ── */}
        {view === 'list' && configured && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {/* Search */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2e39', display: 'flex', gap: 8 }}>
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') setSearchTerm(searchInput); }}
                placeholder="제목, 내용, 작성자 검색..."
                style={{ flex: 1, background: '#12151e', border: '1px solid #3a3e4a', borderRadius: 4, color: '#c9d1d9', fontSize: '0.88rem', padding: '5px 10px' }}
              />
              <button
                onClick={() => setSearchTerm(searchInput)}
                style={{ background: '#2a2e39', border: 'none', borderRadius: 4, color: '#c9d1d9', cursor: 'pointer', fontSize: '0.85rem', padding: '5px 12px' }}
              >
                검색
              </button>
              {searchTerm && (
                <button
                  onClick={() => { setSearchTerm(''); setSearchInput(''); }}
                  style={{ background: 'none', border: '1px solid #3a3e4a', borderRadius: 4, color: '#848e9c', cursor: 'pointer', fontSize: '0.85rem', padding: '5px 10px' }}
                >
                  초기화
                </button>
              )}
            </div>

            {/* Post list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 12px' }}>
              {loading ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#848e9c' }}>불러오는 중...</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#848e9c' }}>
                  {searchTerm ? '검색 결과가 없습니다.' : '첫 번째 글을 작성해보세요!'}
                </div>
              ) : (
                filtered.map(post => (
                  <div key={post.id} style={{ ...s.postRow, ...(post.pinned ? { background: 'rgba(249,168,37,0.05)', borderLeft: '3px solid #f6c90e' } : {}) }}>
                    {/* Post header row */}
                    <div
                      style={s.postHeader}
                      onClick={() => setExpandedId(id => id === post.id ? null : post.id)}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {post.pinned && (
                          <span style={{ background: '#f6c90e', borderRadius: 3, color: '#1a1d27', fontSize: '0.72rem', fontWeight: 700, marginRight: 6, padding: '1px 5px' }}>📌 공지</span>
                        )}
                        <span style={s.postTitle}>{post.title}</span>
                        {post.commentCount > 0 && (
                          <span style={s.commentBadge}>[{post.commentCount}]</span>
                        )}
                        {post.updatedAt && (
                          <span style={{ color: '#848e9c', fontSize: '0.75rem', marginLeft: 6 }}>(수정됨)</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        <span style={s.postMeta}>{post.author}</span>
                        <span style={s.postMeta}>{formatDate(post.createdAt)}</span>
                        <button
                          onClick={e => { e.stopPropagation(); handleEditRequest(post); }}
                          style={s.actionBtn}
                        >
                          수정
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteRequest(post); }}
                          style={{ ...s.actionBtn, color: '#ef5350' }}
                        >
                          삭제
                        </button>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {expandedId === post.id && (
                      <div style={s.postContent}>
                        <div
                          style={{ color: '#c9d1d9', fontSize: '0.9rem', lineHeight: 1.7 }}
                          dangerouslySetInnerHTML={{ __html: post.content }}
                        />
                        <CommentSection postId={post.id} currentUser={currentUser} />
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Load more */}
              {hasMore && !searchTerm && (
                <div style={{ padding: '12px', textAlign: 'center' }}>
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    style={{ background: '#2a2e39', border: 'none', borderRadius: 4, color: '#c9d1d9', cursor: 'pointer', fontSize: '0.88rem', padding: '7px 20px' }}
                  >
                    {loadingMore ? '불러오는 중...' : '더 보기'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Compose View ── */}
        {view === 'compose' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={s.label}>작성자</label>
                <input
                  value={composeAuthor}
                  onChange={e => setComposeAuthor(e.target.value)}
                  placeholder="닉네임"
                  style={s.input}
                />
              </div>
              <div>
                <label style={s.label}>제목</label>
                <input
                  value={composeTitle}
                  onChange={e => setComposeTitle(e.target.value)}
                  placeholder="제목을 입력하세요"
                  style={s.input}
                />
              </div>
            </div>
            <div>
              <label style={s.label}>내용</label>
              <RichTextEditor
                value={composeContent}
                onChange={setComposeContent}
                minHeight={260}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={s.label}>비밀번호 (삭제/수정 시 필요)</label>
                <input
                  type="password"
                  value={composePassword}
                  onChange={e => setComposePassword(e.target.value)}
                  placeholder="비밀번호"
                  style={s.input}
                />
              </div>
              <div>
                <label style={s.label}>비밀번호 확인</label>
                <input
                  type="password"
                  value={composeConfirmPw}
                  onChange={e => setComposeConfirmPw(e.target.value)}
                  placeholder="비밀번호 확인"
                  style={s.input}
                />
              </div>
            </div>
            {composeError && (
              <div style={{ color: '#ef5350', fontSize: '0.85rem' }}>{composeError}</div>
            )}
            {/* Board disclaimer */}
            <div style={{
              background: 'rgba(41,98,255,0.07)',
              border: '1px solid rgba(41,98,255,0.22)',
              borderRadius: 4,
              color: '#7a8090',
              fontSize: '0.75rem',
              lineHeight: 1.55,
              padding: '7px 10px',
            }}>
              ℹ 본 게시판에 게시된 내용은 작성자 개인의 의견이며, 운영자의 공식 입장과 무관합니다. 타인의 명예를 훼손하거나 불법적인 내용의 게시물은 삭제될 수 있으며, 이로 인한 법적 책임은 작성자 본인에게 있습니다.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => setView('list')} style={s.cancelBtn}>취소</button>
              <button onClick={handleSubmit} disabled={submitting} style={s.submitBtn}>
                {submitting ? '등록 중...' : '등록'}
              </button>
            </div>
          </div>
        )}

        {/* ── Edit View ── */}
        {view === 'edit' && editPost && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={s.label}>제목</label>
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="제목을 입력하세요"
                style={s.input}
              />
            </div>
            <div>
              <label style={s.label}>내용</label>
              <RichTextEditor
                value={editContent}
                onChange={setEditContent}
                minHeight={300}
              />
            </div>
            {editError && (
              <div style={{ color: '#ef5350', fontSize: '0.85rem' }}>{editError}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => { setView('list'); setEditPost(null); }} style={s.cancelBtn}>취소</button>
              <button onClick={handleSaveEdit} disabled={editSaving} style={s.submitBtn}>
                {editSaving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Password Dialog */}
      {pwDialog && (
        <PasswordDialog
          title={pwDialog.mode === 'delete' ? '삭제하려면 비밀번호를 입력하세요' : '수정하려면 비밀번호를 입력하세요'}
          onConfirm={handlePasswordConfirm}
          onCancel={() => setPwDialog(null)}
        />
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.65)',
    zIndex: 2000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    background: '#1e222d',
    border: '1px solid #2a2e39',
    borderRadius: 10,
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
    display: 'flex',
    flexDirection: 'column',
    width: 860,
    maxWidth: '96vw',
    height: '88vh',
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    borderBottom: '1px solid #2a2e39',
    display: 'flex',
    flexShrink: 0,
    justifyContent: 'space-between',
    padding: '12px 16px',
  },
  title: {
    color: '#e0e6f0',
    fontSize: '1.02rem',
    fontWeight: 700,
  },
  backBtn: {
    background: 'none',
    border: '1px solid #3a3e4a',
    borderRadius: 4,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.85rem',
    padding: '3px 10px',
  },
  composeBtn: {
    background: '#2962ff',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.88rem',
    fontWeight: 600,
    padding: '5px 14px',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '1.1rem',
    lineHeight: 1,
    padding: '2px 6px',
  },
  postRow: {
    borderBottom: '1px solid #2a2e39',
  },
  postHeader: {
    alignItems: 'center',
    cursor: 'pointer',
    display: 'flex',
    gap: 12,
    padding: '10px 16px',
  },
  postTitle: {
    color: '#c9d1d9',
    fontSize: '0.92rem',
    fontWeight: 500,
  },
  commentBadge: {
    color: '#2962ff',
    fontSize: '0.82rem',
    marginLeft: 6,
  },
  postMeta: {
    color: '#4a5060',
    fontSize: '0.8rem',
    whiteSpace: 'nowrap',
  },
  actionBtn: {
    background: 'none',
    border: '1px solid #3a3e4a',
    borderRadius: 3,
    color: '#848e9c',
    cursor: 'pointer',
    fontSize: '0.78rem',
    padding: '2px 8px',
  },
  postContent: {
    borderTop: '1px solid #2a2e39',
    padding: '12px 16px 16px',
  },
  label: {
    color: '#848e9c',
    display: 'block',
    fontSize: '0.82rem',
    marginBottom: 5,
  },
  input: {
    background: '#12151e',
    border: '1px solid #3a3e4a',
    borderRadius: 4,
    boxSizing: 'border-box' as const,
    color: '#c9d1d9',
    fontSize: '0.9rem',
    padding: '7px 10px',
    width: '100%',
  },
  cancelBtn: {
    background: '#2a2e39',
    border: 'none',
    borderRadius: 4,
    color: '#c9d1d9',
    cursor: 'pointer',
    fontSize: '0.88rem',
    padding: '7px 20px',
  },
  submitBtn: {
    background: '#2962ff',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    fontSize: '0.88rem',
    fontWeight: 600,
    padding: '7px 24px',
  },
};
