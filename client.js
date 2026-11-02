// 穷哥们团队 (AI Team Studio) — Client half.
//
// Two slot registrations, one shared team-state store:
//  - conversation.input.left: the toolbar button, next to 智能体团队/创造模式;
//  - shell.overlay: the settings card itself, rendered only while open.
//
// Plain React (browser module table), theme tokens only, own controls —
// no zcode client package imports. Config travels through the host's
// loopback-only /ai-team/api route (GET summary, POST save/toggle/reset).
window.__ModuleLoader__.load({
  id: '@local/dsh-ai-team',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // ------------------------------------------------------------------
    // Shared team state (button reflects the master switch live)
    // ------------------------------------------------------------------
    const teamState = { loaded: false, loading: false, enabled: true, subs: new Set() };
    function notifyTeamState() {
      for (const fn of teamState.subs) { try { fn(); } catch { /* subscriber died */ } }
    }
    async function refreshTeamState() {
      if (teamState.loading) return;
      teamState.loading = true;
      try {
        const summary = await apiGet();
        teamState.enabled = summary.enabled !== false;
        teamState.loaded = true;
        notifyTeamState();
      } catch { /* host half absent: leave the button neutral */ }
      finally { teamState.loading = false; }
    }
    function useTeamEnabled() {
      const subscribe = React.useCallback((cb) => { teamState.subs.add(cb); return () => teamState.subs.delete(cb); }, []);
      const snapshot = React.useCallback(() => teamState.enabled, []);
      const loaded = React.useCallback(() => teamState.loaded, []);
      React.useEffect(() => { if (!loaded()) refreshTeamState(); }, []);
      return typeof React.useSyncExternalStore === 'function'
        ? React.useSyncExternalStore(subscribe, snapshot)
        : teamState.enabled;
    }

    // ------------------------------------------------------------------
    // Shared card-open state
    //
    // The toolbar button and the shell.overlay card are two separate slot
    // registrations rendered in different subtrees, so they cannot share
    // React context. One module-level store keeps them in sync: the button
    // flips it, the overlay subscribes and renders the card.
    // ------------------------------------------------------------------
    const cardState = { open: false, subs: new Set() };
    function notifyCardState() {
      for (const fn of cardState.subs) { try { fn(); } catch { /* subscriber died */ } }
    }
    function setOpenCard(next) {
      const value = Boolean(next);
      if (cardState.open === value) return;
      cardState.open = value;
      notifyCardState();
    }
    function useCardOpen() {
      const subscribe = React.useCallback((cb) => { cardState.subs.add(cb); return () => cardState.subs.delete(cb); }, []);
      const snapshot = React.useCallback(() => cardState.open, []);
      return typeof React.useSyncExternalStore === 'function'
        ? React.useSyncExternalStore(subscribe, snapshot)
        : cardState.open;
    }

    // ------------------------------------------------------------------
    // Theme tokens (alias tokens degrade, never break)
    // ------------------------------------------------------------------
    const T = {
      border: 'var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
      layer2: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))',
      layer3: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
      fg: 'var(--dsw-alias-label-primary, currentColor)',
      fg2: 'var(--dsw-alias-label-secondary, inherit)',
      fg3: 'var(--dsw-alias-label-tertiary, rgba(127,127,127,0.8))',
      scrim: 'rgba(0,0,0,0.45)',
      accent: 'var(--dsw-alias-label-primary, currentColor)',
      onAccent: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,0.05))',
    };

    const API = '/ai-team/api';
    const EFFORTS = ['', 'off', 'minimal', 'low', 'medium', 'high'];
    const EFFORT_LABELS = { '': '默认', off: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high' };

    // Older host halves answer with a flat `routes` list; convert to the
    // nested provider shape so the card works across a pending restart.
    function normalizeSummary(next) {
      if (next && !Array.isArray(next.providers) && Array.isArray(next.routes)) {
        const map = new Map();
        for (const r of next.routes) {
          if (!r || typeof r.provider !== 'string') continue;
          if (!map.has(r.provider)) map.set(r.provider, { id: r.provider, name: r.provider, models: [] });
          map.get(r.provider).models.push({ id: String(r.model ?? ''), name: String(r.label ?? r.model ?? '') });
        }
        next.providers = [...map.values()];
      }
      return next;
    }

    // Legacy single-route roles arrive without a `routes` array.
    function normalizeRole(role) {
      if (Array.isArray(role?.routes) && role.routes.length > 0) return role;
      const primary = { provider: String(role?.provider ?? ''), model: String(role?.model ?? ''), reasoningEffort: String(role?.reasoningEffort ?? '') };
      return { ...role, routes: [primary] };
    }

    async function apiGet() {
      const res = await fetch(API);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `加载失败 (${res.status})`);
      return normalizeSummary(body);
    }
    async function apiPost(payload) {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `保存失败 (${res.status})`);
      return normalizeSummary(body);
    }

    function routeLabel(route, providers) {
      const p = (providers || []).find((x) => x.id === route.provider);
      const m = p?.models?.find((x) => x.id === route.model);
      const base = `${route.provider || '?'}/${route.model || '?'}`;
      return m ? `${m.name}（${base}）` : base;
    }

    function routeSummary(role, providers) {
      if (!role.routes || role.routes.length === 0) return '继承默认路由';
      const primary = role.routes[0];
      const rest = role.routes.length > 1 ? ` +${role.routes.length - 1} 候补` : '';
      return `${routeLabel(primary, providers)}${rest}`;
    }

    function newRole() {
      return {
        id: `role-${Math.random().toString(36).slice(2, 8)}`,
        name: '新角色',
        routes: [{ provider: '', model: '', reasoningEffort: '' }],
        prompt: '',
        useWhen: '',
        avoidWhen: '',
        restrictTo: [],
        hardGuard: false,
        enabled: true,
      };
    }

    // ------------------------------------------------------------------
    // Toolbar button (conversation.input.left, next to 智能体团队/创造模式)
    // ------------------------------------------------------------------
    function TeamButton() {
      const enabled = useTeamEnabled();
      return h('button', {
        type: 'button',
        onClick: () => setOpenCard(true),
        title: enabled ? '打开穷哥们团队设置' : '穷哥们团队已关闭 — 点击打开设置',
        style: {
          appearance: 'none',
          font: 'inherit',
          fontSize: '12px',
          lineHeight: 1.4,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '5px',
          padding: '3px 10px',
          borderRadius: '999px',
          border: `1px solid ${T.border}`,
          background: enabled ? T.layer3 : 'transparent',
          color: enabled ? T.fg2 : T.fg3,
          opacity: enabled ? 1 : 0.6,
        },
      },
      h('svg', { width: 12, height: 12, viewBox: '0 0 64 64', 'aria-hidden': true },
        h('circle', { cx: 22, cy: 24, r: 10, fill: '#4f6ef7', opacity: enabled ? 0.9 : 0.35 }),
        h('circle', { cx: 42, cy: 24, r: 10, fill: '#9b5cf6', opacity: enabled ? 0.7 : 0.3 }),
        h('circle', { cx: 32, cy: 43, r: 10, fill: '#4f6ef7', opacity: enabled ? 0.5 : 0.2 })),
      h('span', null, '穷哥们团队'),
      );
    }

    // ------------------------------------------------------------------
    // Settings card (shell.overlay)
    // ------------------------------------------------------------------
    function TeamCard() {
      const open = useCardOpen();
      const summaryState = React.useState(null);   // { teamName, enabled, roles, providers }
      const summary = summaryState[0];
      const setSummary = summaryState[1];
      const draftState = React.useState(null);     // editable copy
      const draft = draftState[0];
      const setDraft = draftState[1];
      const expandedState = React.useState(null);  // role id being edited
      const expanded = expandedState[0];
      const setExpanded = expandedState[1];
      const noteState = React.useState('');
      const note = noteState[0];
      const setNote = noteState[1];
      const busyState = React.useState(false);
      const busy = busyState[0];
      const setBusy = busyState[1];

      const load = React.useCallback(() => {
        setNote('');
        apiGet()
          .then((next) => {
            setSummary(next);
            setDraft({
              teamName: next.teamName,
              enabled: next.enabled !== false,
              roles: (next.roles ?? []).map(normalizeRole).map((r) => JSON.parse(JSON.stringify(r))),
            });
            teamState.enabled = next.enabled !== false;
            teamState.loaded = true;
            notifyTeamState();
          })
          .catch((error) => setNote(String(error?.message ?? error)));
      }, []);
      const loadedRef = React.useRef(false);

      React.useEffect(() => {
        if (open && !loadedRef.current) {
          loadedRef.current = true;
          load();
        }
        if (!open) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') setOpenCard(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open, load]);

      if (!open) return null;

      const providers = summary?.providers ?? [];

      const dirty = (() => {
        if (!summary || !draft) return false;
        if (draft.teamName !== summary.teamName) return true;
        return JSON.stringify(draft.roles) !== JSON.stringify((summary.roles ?? []).map(normalizeRole));
      })();

      const patchTeam = (patch) => setDraft((prev) => ({ ...prev, ...patch }));
      const patchRole = (id, patch) => setDraft((prev) => ({
        ...prev,
        roles: prev.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      }));
      const toggleTeam = () => {
        const next = !(draft?.enabled !== false);
        setBusy(true);
        setNote(next ? '开启中…' : '关闭中…');
        apiPost({ enabled: next })
          .then((res) => {
            setSummary(res);
            setDraft((prev) => ({ ...prev, enabled: res.enabled !== false }));
            teamState.enabled = res.enabled !== false;
            notifyTeamState();
            setNote(res.enabled !== false ? '穷哥们团队已开启' : '穷哥们团队已关闭');
          })
          .catch((error) => setNote(String(error?.message ?? error)))
          .finally(() => setBusy(false));
      };
      const addRole = () => {
        const role = newRole();
        setDraft((prev) => ({ ...prev, roles: [...prev.roles, role] }));
        setExpanded(role.id);
      };
      const removeRole = (id) => {
        setDraft((prev) => ({ ...prev, roles: prev.roles.filter((r) => r.id !== id) }));
      };

      const save = () => {
        setBusy(true);
        setNote('保存中…');
        apiPost({ teamName: draft.teamName, roles: draft.roles })
          .then((res) => {
            setSummary(res);
            setDraft({
              teamName: res.teamName,
              enabled: res.enabled !== false,
              roles: (res.roles ?? []).map(normalizeRole).map((r) => JSON.parse(JSON.stringify(r))),
            });
            setNote('已保存 — 新对话即刻生效');
          })
          .catch((error) => setNote(String(error?.message ?? error)))
          .finally(() => setBusy(false));
      };
      const reset = () => {
        setBusy(true);
        setNote('恢复中…');
        apiPost({ reset: true })
          .then((res) => {
            setSummary(res);
            setDraft({
              teamName: res.teamName,
              enabled: res.enabled !== false,
              roles: (res.roles ?? []).map(normalizeRole).map((r) => JSON.parse(JSON.stringify(r))),
            });
            setNote('已恢复默认团队');
          })
          .catch((error) => setNote(String(error?.message ?? error)))
          .finally(() => setBusy(false));
      };

      const controlStyle = {
        appearance: 'none',
        font: 'inherit',
        fontSize: '13px',
        width: '100%',
        padding: '7px 10px',
        borderRadius: '8px',
        border: `1px solid ${T.border}`,
        background: 'transparent',
        color: T.fg,
        boxSizing: 'border-box',
      };
      // Native <select> gets UA-painted chrome in some themes (white box,
      // inherited light text = unreadable). Paint it with the same layer
      // token as the card and declare both color schemes so the popup list
      // follows the app theme instead of the OS default.
      const selectStyle = {
        ...controlStyle,
        backgroundColor: T.layer3,
        colorScheme: 'dark light',
        cursor: 'pointer',
      };
      const rowStyle = { display: 'flex', flexDirection: 'column', gap: '5px', padding: '8px 0' };
      const labelStyle = { fontSize: '12px', color: T.fg3 };
      const field = (label, control, key) => h('div', { key, style: rowStyle },
        h('div', { style: labelStyle }, label), control);

      const textInput = (value, onChange, placeholder) => h('input', {
        type: 'text', value, placeholder, onChange: (e) => onChange(e.target.value), style: controlStyle,
      });
      const areaInput = (value, onChange, placeholder, rows = 2) => h('textarea', {
        value, placeholder, rows, onChange: (e) => onChange(e.target.value),
        style: { ...controlStyle, resize: 'vertical', minHeight: `${rows * 20 + 16}px` },
      });

      const knownRoute = (route) => providers.some((p) => p.id === route.provider
        && p.models?.some((m) => m.id === route.model));

      const routeSelect = (route, onChange) => {
        const value = route.provider === '' && route.model === ''
          ? ''
          : (knownRoute(route) ? `${route.provider}||${route.model}` : '__custom');
        const groups = providers.filter((p) => (p.models?.length ?? 0) > 0);
        return h('select', {
          value,
          onChange: (e) => {
            const v = e.target.value;
            if (v === '') onChange({ provider: '', model: '' });
            else if (v === '__custom') onChange({ provider: route.provider || 'custom-provider', model: route.model });
            else {
              const sep = v.indexOf('||');
              onChange({ provider: v.slice(0, sep), model: v.slice(sep + 2) });
            }
          },
          style: selectStyle,
        }, [
          h('option', { key: '', value: '' }, '（继承默认路由）'),
          ...groups.map((p) => h('optgroup', { key: p.id, label: p.name || p.id },
            p.models.map((m) => h('option', {
              key: m.id,
              value: `${p.id}||${m.id}`,
            }, `${m.name}${m.name !== m.id ? ` · ${m.id}` : ''}`)))),
          h('optgroup', { key: '__custom', label: '自定义' },
            h('option', { key: '__custom', value: '__custom' }, '手填 provider / model…')),
        ]);
      };

      const effortSelect = (route, onChange) => {
        const preset = EFFORTS.includes(route.reasoningEffort) ? route.reasoningEffort : '__custom';
        return h('select', {
          value: preset,
          onChange: (e) => {
            const v = e.target.value;
            onChange({ reasoningEffort: v === '__custom' ? (route.reasoningEffort || 'custom') : v });
          },
          title: '推理力度',
          style: { ...selectStyle, width: '110px', flex: 'none' },
        }, [
          ...EFFORTS.map((e) => h('option', { key: e || 'default', value: e }, EFFORT_LABELS[e])),
          h('option', { key: '__custom', value: '__custom' }, '自定义…'),
        ]);
      };

      const routeChainEditor = (role) => {
        const setRoute = (idx, patch) => patchRole(role.id, {
          routes: role.routes.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
        });
        const addRoute = () => patchRole(role.id, {
          routes: [...role.routes, { provider: '', model: '', reasoningEffort: '' }],
        });
        const removeRoute = (idx) => patchRole(role.id, {
          routes: role.routes.filter((_, i) => i !== idx),
        });
        const rows = role.routes.map((route, i) => {
          const custom = route.provider !== '' && !knownRoute(route);
          return h('div', { key: i, style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 0', borderTop: i > 0 ? `1px dashed ${T.border}` : 'none' } },
            h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
              h('span', { style: { fontSize: '11px', color: T.fg3, flex: 'none', width: '64px' } },
                i === 0 ? '主路由' : `候补 ${i}`),
              h('div', { style: { flex: 1, minWidth: 0 } }, routeSelect(route, (patch) => setRoute(i, patch))),
              effortSelect(route, (patch) => setRoute(i, patch)),
              role.routes.length > 1
                ? h('button', {
                  type: 'button',
                  onClick: () => removeRoute(i),
                  'aria-label': `删除${i === 0 ? '主' : '候补'}路由`,
                  title: '删除',
                  style: {
                    appearance: 'none', font: 'inherit', cursor: 'pointer', border: 0, background: 'none',
                    color: T.fg3, padding: '4px', flex: 'none',
                  },
                }, '✕')
                : null,
            ),
            custom
              ? h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', paddingLeft: '72px' } },
                h('input', { type: 'text', value: route.provider, placeholder: 'provider id', onChange: (e) => setRoute(i, { provider: e.target.value }), style: controlStyle }),
                h('input', { type: 'text', value: route.model, placeholder: 'model id', onChange: (e) => setRoute(i, { model: e.target.value }), style: controlStyle }))
              : null,
          );
        });
        return h('div', { style: rowStyle },
          h('div', { style: labelStyle }, '路由链（主路由失败如额度不足，自动切到候补）'),
          h('div', null, rows),
          h('button', {
            type: 'button',
            onClick: addRoute,
            style: {
              appearance: 'none', font: 'inherit', fontSize: '12px', cursor: 'pointer',
              alignSelf: 'flex-start', padding: '4px 12px', borderRadius: '8px',
              border: `1px dashed ${T.border}`, background: 'none', color: T.fg2,
            },
          }, '＋ 添加候补'),
        );
      };

      const roleRow = (role) => {
        const isOpen = expanded === role.id;
        const header = h('div', {
          style: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%' },
        },
        h('input', {
          type: 'checkbox',
          checked: role.enabled,
          title: role.enabled ? '启用中' : '已停用',
          onChange: (e) => patchRole(role.id, { enabled: e.target.checked }),
        }),
        h('div', { style: { flex: 1, minWidth: 0, textAlign: 'left' } },
          h('div', { style: { fontSize: '14px', fontWeight: 600, color: role.enabled ? T.fg : T.fg3 } },
            role.name || role.id,
            role.hardGuard && role.restrictTo.length > 0
              ? h('span', { style: { fontWeight: 400, fontSize: '11px', color: T.fg3, marginLeft: '8px' } },
                `仅限: ${role.restrictTo.join('/')}`) : null),
          h('div', { style: { fontSize: '12px', color: T.fg3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            routeSummary(role, providers))),
        h('button', {
          type: 'button',
          onClick: () => setExpanded(isOpen ? null : role.id),
          'aria-expanded': isOpen,
          'aria-label': isOpen ? `收起 ${role.name}` : `编辑 ${role.name}`,
          title: isOpen ? '收起' : '编辑',
          style: {
            appearance: 'none', font: 'inherit', cursor: 'pointer', border: 0, background: 'none',
            color: T.fg3, padding: '4px', display: 'inline-flex', alignItems: 'center', flex: 'none',
          },
        },
        h('svg', {
          width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true,
          style: { transition: 'transform .16s', transform: isOpen ? 'rotate(180deg)' : 'none' },
        },
        h('path', {
          d: 'M4 6l4 4 4-4',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        })),
        ),
        );

        const body = !isOpen ? null : h('div', { style: { padding: '2px 0 10px' } },
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
            field('名称', textInput(role.name, (v) => patchRole(role.id, { name: v }), '角色名'), 'name'),
            field('id', textInput(role.id, (v) => patchRole(role.id, { id: v }), '英文 id'), 'id'),
          ),
          routeChainEditor(role),
          field('系统提示词（成员的职责设定）', areaInput(role.prompt, (v) => patchRole(role.id, { prompt: v }), '这个成员是什么、怎么干活…', 3), 'prompt'),
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
            field('适用场景（软约束）', areaInput(role.useWhen, (v) => patchRole(role.id, { useWhen: v }), '什么任务该派给它…'), 'useWhen'),
            field('避免场景（软约束）', areaInput(role.avoidWhen, (v) => patchRole(role.id, { avoidWhen: v }), '什么任务别派给它…'), 'avoidWhen'),
          ),
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'end' } },
            field('仅限任务类别（逗号分隔，留空=不限制）', textInput(role.restrictTo.join(', '), (v) => patchRole(role.id, {
              restrictTo: v.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            }), 'image, design, multimodal'), 'restrictTo'),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', paddingBottom: '8px' } },
              h('input', {
                type: 'checkbox',
                checked: role.hardGuard,
                onChange: (e) => patchRole(role.id, { hardGuard: e.target.checked }),
              }),
              '硬约束（传错类别直接拒绝）'),
          ),
          h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
            h('button', {
              type: 'button',
              onClick: () => removeRole(role.id),
              style: {
                appearance: 'none', font: 'inherit', fontSize: '12px', cursor: 'pointer',
                border: `1px solid ${T.border}`, borderRadius: '8px', padding: '4px 12px',
                background: 'none', color: T.fg2,
              },
            }, '删除角色'),
          ),
        );

        return h('div', {
          key: role.id,
          style: {
            border: `1px solid ${T.border}`,
            borderRadius: '10px',
            background: isOpen ? T.layer2 : 'transparent',
            padding: '10px 12px',
            marginBottom: '8px',
          },
        }, header, body);
      };

      const teamEnabled = draft?.enabled !== false;
      const masterSwitch = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flex: 'none' } },
        h('span', { style: { fontSize: '12px', color: T.fg3 } }, teamEnabled ? '已开启' : '已关闭'),
        h('span', {
          role: 'switch',
          'aria-checked': teamEnabled,
          tabIndex: 0,
          onClick: () => { if (!busy) toggleTeam(); },
          onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); toggleTeam(); } },
          title: '穷哥们团队总开关（关闭后主模型无法派单）',
          style: {
            display: 'inline-flex', alignItems: 'center', width: '36px', height: '20px',
            borderRadius: '999px', padding: '2px', cursor: 'pointer', flex: 'none',
            background: teamEnabled ? 'var(--dsw-alias-label-primary, currentColor)' : T.border,
            transition: 'background .16s',
          },
        },
        h('span', {
          style: {
            display: 'inline-block', width: '16px', height: '16px', borderRadius: '50%',
            background: 'var(--dsw-alias-bg-layer-2, #fff)',
            transform: teamEnabled ? 'translateX(16px)' : 'translateX(0)',
            transition: 'transform .16s',
          },
        }),
        ));

      const body = !draft
        ? h('div', { style: { padding: '16px 0', fontSize: '13px', color: T.fg3 } }, note || '加载中…')
        : h('div', null,
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'end' } },
            field('团队名称', textInput(draft.teamName, (v) => patchTeam({ teamName: v }), '穷哥们团队'), 'teamName'),
            h('div', { style: { paddingBottom: '8px' } }, masterSwitch),
          ),
          h('div', { style: { fontSize: '12px', color: T.fg3, margin: '4px 0 8px' } },
            '成员在独立上下文中用各自配置的路由链执行子任务；主模型按名册里的职责与约束选择成员（软约束），开启「硬约束」后传错任务类别会被直接拒绝。'
            + '总开关关闭后，主模型无法派单。主路由失败（额度不足、模型下线）自动切换候补；候补全部失败才报错。'),
          draft.roles.map((role) => roleRow(role)),
          h('button', {
            type: 'button',
            onClick: addRole,
            style: {
              appearance: 'none', font: 'inherit', fontSize: '13px', cursor: 'pointer',
              width: '100%', padding: '8px', borderRadius: '10px',
              border: `1px dashed ${T.border}`, background: 'none', color: T.fg2,
            },
          }, '＋ 添加角色'),
          );

      return h('div', {
        style: {
          position: 'fixed', inset: 0, zIndex: 9999,
          background: T.scrim,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
        onClick: () => setOpenCard(false),
      },
      h('div', {
        role: 'dialog',
        'aria-modal': true,
        'aria-label': '穷哥们团队设置',
        onClick: (e) => e.stopPropagation(),
        style: {
          width: 'min(680px, calc(100vw - 48px))',
          maxHeight: 'calc(100vh - 96px)',
          overflowY: 'auto',
          background: T.layer2,
          border: `1px solid ${T.border}`,
          borderRadius: '14px',
          padding: '18px 20px',
          color: T.fg,
          boxShadow: '0 12px 48px rgba(0,0,0,0.35)',
        },
      },
      h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '10px' } },
        h('div', { style: { flex: 1 } },
          h('div', { style: { fontSize: '16px', fontWeight: 600 } }, '穷哥们团队设置'),
          h('div', { style: { fontSize: '12px', color: T.fg3 } }, '配置成员、路由候补链与调度约束'),
        ),
        h('button', {
          type: 'button',
          onClick: () => setOpenCard(false),
          'aria-label': '关闭',
          style: {
            appearance: 'none', font: 'inherit', cursor: 'pointer',
            border: `1px solid ${T.border}`, borderRadius: '8px', padding: '4px 10px',
            background: 'none', color: T.fg2,
          },
        }, '✕'),
      ),
      body,
      h('div', {
        style: {
          borderTop: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '12px 0 2px', marginTop: '8px',
        },
      },
      h('button', {
        type: 'button',
        disabled: busy,
        onClick: reset,
        style: {
          appearance: 'none', font: 'inherit', fontSize: '12px', cursor: busy ? 'default' : 'pointer',
          border: 0, background: 'none', color: T.fg3, textDecoration: 'underline', textUnderlineOffset: '2px',
          opacity: busy ? 0.4 : 1,
        },
      }, '恢复默认团队'),
      h('span', { role: 'status', style: { flex: 1, textAlign: 'right', fontSize: '12px', color: T.fg3 } }, note),
      h('button', {
        type: 'button',
        disabled: !dirty || busy,
        onClick: save,
        style: {
          appearance: 'none', font: 'inherit', fontSize: '13px', lineHeight: 1.5,
          cursor: dirty && !busy ? 'pointer' : 'default',
          border: '1px solid transparent', borderRadius: '8px', padding: '5px 16px',
          background: T.accent, color: T.onAccent, opacity: dirty && !busy ? 1 : 0.4,
        },
      }, '保存'),
      ),
      ));
    }

    // ------------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------------
    return {
      inject: ['slots'],
      apply(ctx) {
        // Toolbar seat beside the composer tool row's other compact controls
        // (智能体团队 / 创造模式 live in the same row).
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left', id: 'ai-team-toolbar', order: 50, label: '穷哥们团队',
        }, TeamButton));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'ai-team-card', order: 60, label: '穷哥们团队设置',
        }, TeamCard));
      },
    };
  },
});
