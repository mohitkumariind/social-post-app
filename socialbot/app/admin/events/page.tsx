"use client";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Filter,
  Folder,
  Image as ImageIcon,
  Layers,
  MessageSquare,
  Pencil,
  Plus,
  PlusCircle,
  Trash2,
  Users,
  Video,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { adminStorageRemove, adminStorageUploadWithProgress } from '@/lib/admin-storage-client';
import UploadQueuePanel from '@/components/admin/UploadQueuePanel';
import { MultiSelectDropdown } from '@/components/admin/MultiSelectDropdown';
import { useAdminUploadQueue } from '@/hooks/useAdminUploadQueue';
import { supabase } from '@/lib/supabase';
import { isActiveEventDashboardCategory } from '@/lib/dashboard-event-category';
import { isPartyOtherId, PARTIES_DATA } from '@/lib/constants';
import { getStateVisibility } from '@/lib/admin/state-filter';
import { useDashboardAccess } from '@/lib/hooks/useDashboardAccess';
import { buildEventPermissionMap } from '@/lib/rbac/event-permission-map';
import { getEventUiCapabilities } from '@/lib/rbac/ui-capabilities';
import {
  logEventFormHydration,
  mergeStateOptionsForEdit,
  resolveAssemblySelectionsFromEvent,
  resolveLoksabhaSelectionsFromEvent,
  editorGeoSelectionForForm,
  resolveEditorGeoIdsForPayload,
  resolvePartySelectionsFromEvent,
  resolveStateSelectionsFromEvent,
  stateLabelsForIds,
} from '@/lib/admin/event-form-hydration';
import {
  logEditorPartyDebug,
  mergePartiesForEdit,
  partiesVisibleToEditor,
} from '@/lib/admin/editor-party-scope';
import {
  buildEditorPartyTargetingFromForm,
  logEditorTargetingDebug,
  scopeIdsForPostFromRow,
} from '@/lib/admin/editor-event-targeting';
import { captionsJsonForPostColumn, isLikelyEventUuid, normalizeCaptionsFromDb } from '@/lib/captions';

const __DEV__ = process.env.NODE_ENV !== 'production';

const devConsole = {
  log: (...args: any[]) => {
    if (__DEV__) console.log(...args);
  },
  warn: (...args: any[]) => {
    if (__DEV__) console.warn(...args);
  },
  error: (...args: any[]) => {
    if (__DEV__) console.error(...args);
  },
};

// --- TYPES ---
interface Post {
  id: string;
  url: string;
  type: 'video' | 'image';
  name: string;
  dashboard_category?: string | null;
}

interface CampaignEvent {
  id: string | number;
  name: string;
  start: string;
  end: string;
  scheduled_at?: string | null;
  created_by?: string | null;
  created_role?: string | null;
  status?: string | null;
  party?: string[];
  state?: string[];
  state_id?: number[];
  loksabha?: string[];
  assembly?: string[];
  target_groups?: string[];
  /** Event-level dashboard quick category (null = none). */
  dashboard_category?: string | null;
  /** Precomputed for list cards; `posts` are only loaded on Manage. */
  assetsCount: number;
  posts: Post[];
  captions: string[];
}

type UiDashboardCategory =
  | 'none'
  | 'good_morning'
  | 'good_night'
  | 'motivation'
  | 'devotional'
  | 'birthday_wishes';

function dashboardCategoryToDb(v: UiDashboardCategory): string | null {
  return v === 'none' ? null : v;
}

function dashboardCategoryFromDb(v: unknown): UiDashboardCategory {
  return isActiveEventDashboardCategory(v) ? (v as UiDashboardCategory) : 'none';
}

/** Normalize party/state from DB: string | string[] -> string[] */
function toStrArr(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v].filter(Boolean);
}

function toNumArrFromStrIds(v: string[]): number[] {
  // Special case: "ALL" should be stored as numeric wildcard [0]
  if ((v ?? []).some((x) => String(x).trim().toUpperCase() === 'ALL')) return [0];
  return (v ?? []).map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

// Simple Number Conversion Helper (strict numeric arrays)
const toNumArr = (val: any): number[] => {
  if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) return [];
  if (val === 'ALL' || (Array.isArray(val) && val.includes('ALL'))) return [0];
  const arr = Array.isArray(val) ? val : [val];
  return arr.map((id) => Number(id)).filter((n) => Number.isFinite(n));
};

export default function App() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [view, setView] = useState<'list' | 'gallery'>('list');
  const [selectedEvent, setSelectedEvent] = useState<CampaignEvent | null>(null);
  const [postToDelete, setPostToDelete] = useState<Post | null>(null);
  const [newEventDashboardCategory, setNewEventDashboardCategory] = useState<UiDashboardCategory>('none');
  const [editEventDashboardCategory, setEditEventDashboardCategory] = useState<UiDashboardCategory>('none');
  const [captionToDelete, setCaptionToDelete] = useState<number | null>(null); 
  const [newCaptionText, setNewCaptionText] = useState(''); 
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaUploadQueue = useAdminUploadQueue(4);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000); 
    return () => clearInterval(timer);
  }, []);

  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [scheduledAt, setScheduledAt] = useState<string>(''); // datetime-local
  const [scheduleUiOpen, setScheduleUiOpen] = useState(false);
  const [newParty, setNewParty] = useState<string[]>([]);
  const [newState, setNewState] = useState<string[]>([]);
  const [newLoksabha, setNewLoksabha] = useState<string[]>([]);
  const [newAssembly, setNewAssembly] = useState<string[]>([]);
  const [newTargetGroups, setNewTargetGroups] = useState<string[]>([]);
  const isCreateCategoryMode = newEventDashboardCategory !== 'none';
  const [groupOptions, setGroupOptions] = useState<{ tag: string; name?: string; count: number }[]>([]);
  const [filterParty, setFilterParty] = useState<string>('ALL');
  const [filterState, setFilterState] = useState<string>('ALL');
  const [availableStates, setAvailableStates] = useState<{ id: string; name: string }[]>([]);
  const [availableLoksabhas, setAvailableLoksabhas] = useState<{ id: string; name: string; state_id: string }[]>([]);
  const [availableAssemblies, setAvailableAssemblies] = useState<{ id: string; name: string; loksabha_id: string }[]>([]);
  const [statesLoading, setStatesLoading] = useState(true);
  const [loksabhasLoading, setLoksabhasLoading] = useState(false);
  const [assembliesLoading, setAssembliesLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<CampaignEvent | null>(null);
  const [editingEvent, setEditingEvent] = useState<CampaignEvent | null>(null);
  const [workerNotifyToast, setWorkerNotifyToast] = useState(false);
  const skipLoksabhaResetCountRef = useRef(0);

  const { ready: viewerReady, access: dashboardAccess } = useDashboardAccess();
  const viewer = dashboardAccess?.actor ?? null;
  const viewerLoading = !viewerReady;
  const eventPermissions = dashboardAccess?.permissions;
  const eventCaps = dashboardAccess?.permissions.events ?? getEventUiCapabilities({
    id: '',
    role: 'editor',
    assigned_state_ids: [],
    assigned_group_ids: [],
    assigned_party_ids: [],
  });

  const { visibleStates, hasSingleAssignedState, singleAssignedStateId } = useMemo(
    () =>
      getStateVisibility({
        viewer: viewer
          ? {
              role: viewer.role,
              assigned_state_ids: viewer.assigned_state_ids,
              assigned_group_ids: viewer.assigned_group_ids,
              assigned_party_ids: viewer.assigned_party_ids,
            }
          : null,
        viewerLoading,
        allStates: availableStates,
      }),
    [viewer, viewerLoading, availableStates]
  );

  const canUseGlobalEventFilter = eventCaps.canUseGlobalTargeting;

  const eventPermissionById = useMemo(
    () => buildEventPermissionMap(events, eventPermissions),
    [events, eventPermissions]
  );

  const canEditEventRow = (ev: CampaignEvent) => eventPermissionById.get(String(ev.id))?.canEdit ?? false;
  const canDeleteEventRow = (ev: CampaignEvent) => eventPermissionById.get(String(ev.id))?.canDelete ?? false;
  const canUploadToEventRow = (ev: CampaignEvent) => eventPermissionById.get(String(ev.id))?.canUpload ?? false;

  const selectedEventPermissions = useMemo(() => {
    if (!selectedEvent) return { canEdit: false, canUpload: false, canDelete: false };
    const row = eventPermissionById.get(String(selectedEvent.id));
    return {
      canEdit: row?.canEdit ?? false,
      canUpload: row?.canUpload ?? false,
      canDelete: row?.canDelete ?? false,
    };
  }, [selectedEvent, eventPermissionById]);

  const editorAssignableStates = useMemo(() => {
    if (!eventCaps.editorForm) return availableStates;
    const ids = viewer?.assigned_state_ids ?? [];
    if (ids.length === 0) return [];
    const allowed = new Set(ids.map((n) => String(n)));
    return availableStates.filter((s) => allowed.has(String(s.id)));
  }, [eventCaps.editorForm, viewer?.assigned_state_ids, availableStates]);

  const editorAssignableParties = useMemo(() => {
    if (!eventCaps.editorForm) return PARTIES_DATA;
    return partiesVisibleToEditor(PARTIES_DATA, viewer?.assigned_party_ids ?? []);
  }, [eventCaps.editorForm, viewer?.assigned_party_ids]);

  const isEditMode = editingEvent != null;

  const editFormPartyOptions = useMemo(() => {
    if (!isEditMode) return eventCaps.editorForm ? editorAssignableParties : PARTIES_DATA;
    const visible = eventCaps.editorForm ? editorAssignableParties : PARTIES_DATA;
    return mergePartiesForEdit(visible, PARTIES_DATA, newParty);
  }, [isEditMode, eventCaps.editorForm, editorAssignableParties, newParty]);

  const editFormStateOptions = useMemo(() => {
    if (!isEditMode) return viewerReady ? visibleStates : [];
    return mergeStateOptionsForEdit(visibleStates, availableStates, newState);
  }, [isEditMode, viewerReady, visibleStates, availableStates, newState]);

  const editStateReadonlyLabel = useMemo(() => {
    if (!isEditMode) return visibleStates[0]?.name ?? '—';
    return stateLabelsForIds(newState, availableStates);
  }, [isEditMode, newState, availableStates, visibleStates]);

  useEffect(() => {
    if (!isEditMode || !editingEvent) return;
    logEventFormHydration('edit_form_render_values', {
      event_id: editingEvent.id,
      newState,
      newParty,
      newLoksabha,
      newAssembly,
      editStateReadonlyLabel,
      editFormStateOptionIds: editFormStateOptions.map((s) => s.id),
    });
    if (eventCaps.editorForm) {
      logEditorPartyDebug('edit_form_render_party', {
        editor_allowed_parties: editorAssignableParties.map((p) => p.id),
        selected_party: newParty,
        editFormPartyOptionIds: editFormPartyOptions.map((p) => p.id),
      });
    }
  }, [
    isEditMode,
    editingEvent,
    newState,
    newParty,
    newLoksabha,
    newAssembly,
    editStateReadonlyLabel,
    editFormStateOptions,
    eventCaps.editorForm,
    editorAssignableParties,
    editFormPartyOptions,
  ]);

  useEffect(() => {
    if (!isCreateCategoryMode) return;
    setNewParty([]);
    setNewState([]);
    setNewLoksabha([]);
    setNewAssembly([]);
    setNewTargetGroups([]);
  }, [isCreateCategoryMode]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/groups', { credentials: 'same-origin' });
        if (!res.ok) return;
        const json = (await res.json()) as { groups?: { tag: string; name?: string; count: number }[] };
        if (!cancelled) setGroupOptions(json.groups ?? []);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Fetch states from Supabase on mount. No fallback - empty on error or no rows. */
  useEffect(() => {
    const fetchStates = async () => {
      setStatesLoading(true);
      const { data, error } = await supabase.from('states').select('*');
      if (error) {
        if (__DEV__) console.error('fetchStates error:', error.message);
        setAvailableStates([]);
      } else {
        const raw = data ?? [];
        const mapped = raw.map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ''),
          name: String(r.name ?? r.state_name ?? r.state ?? ''),
        })).filter((s) => s.id && s.name);
        setAvailableStates(mapped);
      }
      setStatesLoading(false);
    };
    fetchStates();
  }, []);

  useEffect(() => {
    const fetchEvents = async () => {
      const res = await fetch('/api/admin/events', { credentials: 'same-origin' });
      const payload = (await res.json().catch(() => ({}))) as { events?: any[]; error?: string };
      if (!res.ok) {
        if (__DEV__) console.error('fetchEvents error:', payload.error ?? res.status);
        setEvents([]);
        return;
      }
      const data = payload.events ?? [];
      const base: CampaignEvent[] = (data || [])
        .map(
          (row: {
            id?: string;
            name: string;
            start?: string;
            end?: string;
            created_by?: string | null;
            created_role?: string | null;
            status?: string | null;
            party?: string | string[];
            state?: string | string[];
            state_id?: number[] | string | null;
            loksabha?: string | string[];
            assembly?: string | string[];
            target_groups?: string | string[];
            captions?: unknown;
            dashboard_category?: unknown;
            assets_count?: number | string | null;
          }) => {
            const ac = row.assets_count;
            const parsedAssets =
              typeof ac === 'number' && Number.isFinite(ac)
                ? ac
                : typeof ac === 'string' && ac.trim() !== ''
                  ? Number(ac)
                  : 0;
            const stateIdArr = Array.isArray(row.state_id)
              ? row.state_id.map((x) => Number(x)).filter((n) => Number.isFinite(n))
              : [];
            return {
              id: String(row.id ?? '').trim(),
              name: row.name,
              start: row.start ?? '',
              end: row.end ?? '',
              created_by: row.created_by != null ? String(row.created_by) : null,
              created_role: row.created_role != null ? String(row.created_role) : null,
              status: row.status != null ? String(row.status) : null,
              party: toStrArr(row.party),
              state: toStrArr(row.state),
              state_id: stateIdArr.length > 0 ? stateIdArr : undefined,
              loksabha: toStrArr(row.loksabha),
              assembly: toStrArr(row.assembly),
              target_groups: toStrArr(row.target_groups),
              dashboard_category: isActiveEventDashboardCategory(row.dashboard_category) ? String(row.dashboard_category) : null,
              assetsCount: Number.isFinite(parsedAssets) ? parsedAssets : 0,
              posts: [],
              captions: normalizeCaptionsFromDb(row.captions),
            };
          }
        )
        .filter((e) => e.id.length > 0);

      setEvents(base);
    };
    fetchEvents().finally(() => setEventsLoading(false));
  }, []);


  // Moderator UX: lock state on CREATE only — never overwrite edit form; no global list filter UI.
  useEffect(() => {
    if (!viewerReady || !eventCaps.lockCreateStateToScope || isEditMode) return;
    const allowedIds = visibleStates.map((s) => String(s.id));
    if (allowedIds.length === 0) return;

    if (hasSingleAssignedState && singleAssignedStateId) {
      const only = singleAssignedStateId;
      if (newState.length !== 1 || newState[0] !== only) {
        logEventFormHydration('moderator_create_lock_state', { only, previous: newState });
        setNewState([only]);
      }
      return;
    }

    const allowed = new Set(allowedIds);
    const cleaned = newState.filter((id) => id !== 'ALL' && allowed.has(String(id)));
    if (cleaned.length !== newState.length) {
      logEventFormHydration('moderator_create_prune_state', { before: newState, after: cleaned });
      setNewState(cleaned);
    }
  }, [
    viewerReady,
    eventCaps.lockCreateStateToScope,
    isEditMode,
    hasSingleAssignedState,
    singleAssignedStateId,
    visibleStates,
    newState,
  ]);

  const selectedStateKey = useMemo(() => {
    const ids = newState.includes('ALL') ? visibleStates.map((s) => String(s.id)) : newState.filter((v) => v !== 'ALL');
    const uniq = Array.from(new Set(ids.map(String).filter(Boolean)));
    uniq.sort();
    return uniq.join(',');
  }, [newState, visibleStates]);

  const loksabhaReqIdRef = useRef(0);

  /** Fetch Lok Sabha when state selection changes. Uses integer IDs for Supabase query. */
  useEffect(() => {
    if (eventCaps.editorForm || eventCaps.campaignManagerForm) return;
    const ids = selectedStateKey ? selectedStateKey.split(',').filter(Boolean) : [];
    if (ids.length === 0) {
      setAvailableLoksabhas([]);
      setNewLoksabha([]);
      setAvailableAssemblies([]);
      setNewAssembly([]);
      setLoksabhasLoading(false);
      return;
    }

    const reqId = ++loksabhaReqIdRef.current;
    setLoksabhasLoading(true);
    (async () => {
      const idsAsNumbers = ids.map((id) => Number(id)).filter((n) => Number.isFinite(n));
      if (idsAsNumbers.length === 0) {
        if (reqId === loksabhaReqIdRef.current) {
          setAvailableLoksabhas([]);
          setNewLoksabha([]);
          setAvailableAssemblies([]);
          setNewAssembly([]);
          setLoksabhasLoading(false);
        }
        return;
      }

      const { data, error } = await supabase.from('loksabha').select('*').in('state_id', idsAsNumbers);
      if (reqId !== loksabhaReqIdRef.current) return;

      if (error) {
        if (__DEV__) console.error('fetchLoksabhas error:', error.message);
        setAvailableLoksabhas([]);
        setNewLoksabha([]);
        setAvailableAssemblies([]);
        setNewAssembly([]);
        setLoksabhasLoading(false);
        return;
      }

      const raw = data ?? [];
      const mapped = raw
        .map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ''),
          name: String(r.name ?? r.loksabha_name ?? ''),
          state_id: String(r.state_id ?? r.state ?? ''),
        }))
        .filter((l) => l.id && l.name);
      setAvailableLoksabhas(mapped);
      setLoksabhasLoading(false);
    })();
  }, [selectedStateKey, eventCaps.editorForm, eventCaps.campaignManagerForm]);

  /** Editors: lok sabha / assembly from profile assignment, optionally scoped to selected states. */
  useEffect(() => {
    if (!eventCaps.editorForm || !viewerReady) return;
    let cancelled = false;
    (async () => {
      setLoksabhasLoading(true);
      setAssembliesLoading(true);
      try {
        const assignedLok = new Set((viewer?.assigned_loksabha_ids ?? []).map((n) => String(n)));
        const assignedAsm = new Set((viewer?.assigned_assembly_ids ?? []).map((n) => String(n)));
        const stateFilterIds = new Set(
          (newState.includes('ALL') ? editorAssignableStates : newState.filter((x) => x !== 'ALL'))
            .map((x) => Number(x))
            .filter((n) => Number.isFinite(n))
        );

        const { data: lokRows } = await supabase.from('loksabha').select('id,name,state_id').order('name');
        if (cancelled) return;
        let lokMapped = (lokRows ?? [])
          .map((r: Record<string, unknown>) => ({
            id: String(r.id ?? ''),
            name: String(r.name ?? r.loksabha_name ?? ''),
            state_id: String(r.state_id ?? ''),
          }))
          .filter((l) => l.id && l.name);
        if (assignedLok.size > 0) lokMapped = lokMapped.filter((l) => assignedLok.has(l.id));
        if (stateFilterIds.size > 0) {
          lokMapped = lokMapped.filter((l) => stateFilterIds.has(Number(l.state_id)));
        }

        const lokIdsForAsm = newLoksabha.includes('ALL')
          ? lokMapped.map((l) => l.id)
          : newLoksabha.filter((x) => x !== 'ALL');
        const lokIdSet = new Set(lokIdsForAsm.map(String));

        const { data: asmRows } = await supabase.from('assembly').select('id,name,loksabha_id').order('name');
        if (cancelled) return;
        let asmMapped = (asmRows ?? [])
          .map((r: Record<string, unknown>) => ({
            id: String(r.id ?? ''),
            name: String(r.name ?? r.assembly_name ?? ''),
            loksabha_id: String(r.loksabha_id ?? ''),
          }))
          .filter((a) => a.id && a.name);
        if (assignedAsm.size > 0) asmMapped = asmMapped.filter((a) => assignedAsm.has(a.id));
        if (lokIdSet.size > 0) {
          asmMapped = asmMapped.filter((a) => lokIdSet.has(String(a.loksabha_id)));
        } else if (stateFilterIds.size > 0 && assignedAsm.size === 0) {
          const visibleLokIds = new Set(lokMapped.map((l) => l.id));
          asmMapped = asmMapped.filter((a) => visibleLokIds.has(String(a.loksabha_id)));
        }

        setAvailableLoksabhas(lokMapped);
        setAvailableAssemblies(asmMapped);
      } catch {
        if (!cancelled) {
          setAvailableLoksabhas([]);
          setAvailableAssemblies([]);
        }
      } finally {
        if (!cancelled) {
          setLoksabhasLoading(false);
          setAssembliesLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    eventCaps.editorForm,
    viewerReady,
    viewer?.assigned_loksabha_ids,
    viewer?.assigned_assembly_ids,
    newState,
    newLoksabha,
    editorAssignableStates,
  ]);

  /** Campaign managers: load constituency options from profile assignment (not state filter). */
  useEffect(() => {
    if (!eventCaps.campaignManagerForm) return;
    let cancelled = false;
    (async () => {
      setLoksabhasLoading(true);
      setAssembliesLoading(true);
      try {
        const assignedLok = new Set((viewer?.assigned_loksabha_ids ?? []).map((n) => String(n)));
        const assignedAsm = new Set((viewer?.assigned_assembly_ids ?? []).map((n) => String(n)));
        const { data: lokRows } = await supabase.from('loksabha').select('id,name,state_id').order('name');
        const { data: asmRows } = await supabase.from('assembly').select('id,name,loksabha_id').order('name');
        if (cancelled) return;
        const lokMapped = (lokRows ?? [])
          .map((r: Record<string, unknown>) => ({
            id: String(r.id ?? ''),
            name: String(r.name ?? r.loksabha_name ?? ''),
            state_id: String(r.state_id ?? ''),
          }))
          .filter((l) => l.id && l.name && (assignedLok.size === 0 || assignedLok.has(l.id)));
        const asmMapped = (asmRows ?? [])
          .map((r: Record<string, unknown>) => ({
            id: String(r.id ?? ''),
            name: String(r.name ?? r.assembly_name ?? ''),
            loksabha_id: String(r.loksabha_id ?? ''),
          }))
          .filter((a) => a.id && a.name && (assignedAsm.size === 0 || assignedAsm.has(a.id)));
        setAvailableLoksabhas(lokMapped);
        setAvailableAssemblies(asmMapped);
      } catch {
        if (!cancelled) {
          setAvailableLoksabhas([]);
          setAvailableAssemblies([]);
        }
      } finally {
        if (!cancelled) {
          setLoksabhasLoading(false);
          setAssembliesLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventCaps.campaignManagerForm, viewer?.assigned_loksabha_ids, viewer?.assigned_assembly_ids]);

  // Prune selected LS to only those still available (preserve when possible).
  useEffect(() => {
    if (isEditMode) return;
    if (availableLoksabhas.length === 0) return;
    if (newLoksabha.includes('ALL')) return;
    const allowed = new Set(availableLoksabhas.map((l) => String(l.id)));
    const cleaned = newLoksabha.filter((id) => id !== 'ALL' && allowed.has(String(id)));
    if (cleaned.length !== newLoksabha.length) setNewLoksabha(cleaned);
  }, [availableLoksabhas, newLoksabha, isEditMode]);

  const selectedLoksabhaKey = useMemo(() => {
    const ids = newLoksabha.includes('ALL') ? availableLoksabhas.map((l) => String(l.id)) : newLoksabha.filter((v) => v !== 'ALL');
    const uniq = Array.from(new Set(ids.map(String).filter(Boolean)));
    uniq.sort();
    return uniq.join(',');
  }, [newLoksabha, availableLoksabhas]);

  const assemblyReqIdRef = useRef(0);

  /** Fetch Assembly when Lok Sabha selection changes. Uses integer IDs for Supabase query. */
  useEffect(() => {
    if (eventCaps.editorForm || eventCaps.campaignManagerForm) return;
    const ids = selectedLoksabhaKey ? selectedLoksabhaKey.split(',').filter(Boolean) : [];
    if (ids.length === 0) {
      setAvailableAssemblies([]);
      setNewAssembly([]);
      setAssembliesLoading(false);
      return;
    }

    const reqId = ++assemblyReqIdRef.current;
    setAssembliesLoading(true);
    (async () => {
      const idsAsNumbers = ids.map((id) => Number(id)).filter((n) => Number.isFinite(n));
      if (idsAsNumbers.length === 0) {
        if (reqId === assemblyReqIdRef.current) {
          setAvailableAssemblies([]);
          setNewAssembly([]);
          setAssembliesLoading(false);
        }
        return;
      }
      const { data, error } = await supabase.from('assembly').select('*').in('loksabha_id', idsAsNumbers);
      if (reqId !== assemblyReqIdRef.current) return;

      if (error) {
        if (__DEV__) console.error('fetchAssemblies error:', error.message);
        setAvailableAssemblies([]);
        setNewAssembly([]);
        setAssembliesLoading(false);
        return;
      }

      const raw = data ?? [];
      const mapped = raw
        .map((r: Record<string, unknown>) => ({
          id: String(r.id ?? ''),
          name: String(r.name ?? r.assembly_name ?? ''),
          loksabha_id: String(r.loksabha_id ?? r.loksabhaId ?? r.loksabha ?? ''),
        }))
        .filter((a) => a.id && a.name);
      setAvailableAssemblies(mapped);
      setAssembliesLoading(false);
    })();
  }, [selectedLoksabhaKey, eventCaps.editorForm, eventCaps.campaignManagerForm]);

  // Prune selected assemblies to only those still available (preserve when possible).
  useEffect(() => {
    if (isEditMode) return;
    if (availableAssemblies.length === 0) return;
    if (newAssembly.includes('ALL')) return;
    const allowed = new Set(availableAssemblies.map((a) => String(a.id)));
    const cleaned = newAssembly.filter((id) => id !== 'ALL' && allowed.has(String(id)));
    if (cleaned.length !== newAssembly.length) setNewAssembly(cleaned);
  }, [availableAssemblies, newAssembly, isEditMode]);

  const getStatus = (sDate: string, eDate: string) => {
    const now = currentTime.getTime();
    const s = new Date(sDate).getTime();
    const e = new Date(eDate).getTime();
    if (now < s) return { id: 'soon', label: 'Upcoming', color: 'bg-blue-50 text-blue-600' };
    if (now >= s && now <= e) return { id: 'live', label: 'Live Now', color: 'bg-green-50 text-green-600', pulse: true };
    return { id: 'done', label: 'Expired', color: 'bg-slate-100 text-slate-400' };
  };

  const fetchEventByIdOrName = async (ev: Pick<CampaignEvent, 'id' | 'name'>) => {
    const idStr = String(ev.id ?? '').trim();
    const usp = new URLSearchParams();
    if (isLikelyEventUuid(idStr)) usp.set('id', idStr);
    else usp.set('name', String(ev.name ?? '').trim());
    const res = await fetch(`/api/admin/events?${usp.toString()}`, { credentials: 'same-origin' });
    const d = (await res.json().catch(() => ({}))) as { event?: any; error?: string };
    if (!res.ok) return { data: null, error: { message: d.error || `HTTP ${res.status}` } } as any;
    return { data: d.event ?? null, error: null } as any;
  };

  const updateEventByIdOrName = async (ev: Pick<CampaignEvent, 'id' | 'name'>, patch: Record<string, unknown>) => {
    const idStr = String(ev.id ?? '').trim();
    if (!isLikelyEventUuid(idStr)) {
      return { data: null, error: { message: 'Missing stable event id; cannot update.' } } as any;
    }
    const res = await fetch('/api/admin/events', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: idStr, patch }),
    });
    const d = (await res.json().catch(() => ({}))) as { event?: any; error?: string };
    if (!res.ok) return { data: null, error: { message: d.error || `HTTP ${res.status}` } } as any;
    return { data: d.event, error: null } as any;
  };

  const deleteEventRowByIdOrName = async (ev: CampaignEvent): Promise<{ ok: true } | { ok: false; error: string }> => {
    const idStr = String(ev.id ?? '').trim();
    if (!isLikelyEventUuid(idStr)) {
      devConsole.error('Events delete error: Missing stable event id.');
      return { ok: false, error: 'Missing stable event id. Refresh the page and try again.' };
    }
    const res = await fetch(`/api/admin/events?id=${encodeURIComponent(idStr)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      const msg = String(d.error ?? `HTTP ${res.status}`).trim() || 'Delete failed';
      devConsole.error('Events delete error:', msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  };

  /**
   * Push `events.captions` snapshot onto every post in this campaign (`posts.category` = event name).
   * We intentionally match **category only** (no `is_video` / `language` filters): those filters were skipping
   * rows (e.g. DB default `is_video = true`, or language mismatch) so captions never updated.
   */
  const syncGraphicsPostCaptions = async (ev: CampaignEvent, captionsList: string[]) => {
    const jsonStr = captionsJsonForPostColumn(captionsList);
    try {
      let res = await fetch('/api/admin/posts', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: ev.name, patch: { captions: captionsList } }),
      });
      if (!res.ok) {
        res = await fetch('/api/admin/posts', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: ev.name, patch: { captions: jsonStr } }),
        });
      }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        devConsole.error('sync graphics captions to posts:', d.error ?? res.status);
      }
    } catch (e) {
      devConsole.error('sync graphics captions to posts:', e);
    }
  };

  const createEvent = async () => {
    if (!newName || !startDate || !endDate) return;
    const startVal = `${startDate}T00:00:00Z`;
    const endVal = `${endDate}T23:59:59Z`;
    const payload: Record<string, unknown> = { name: newName, start: startVal, end: endVal, captions: [] };
    if (eventCaps.editorForm && scheduledAt) {
      alert('Editors cannot schedule publish; events are saved as drafts.');
      return;
    }
    if (!eventCaps.editorForm && scheduledAt) {
      const iso = new Date(scheduledAt).toISOString();
      if (iso <= new Date().toISOString()) {
        alert('scheduled_at must be a future date/time');
        return;
      }
      payload.scheduled_at = iso;
    }
    const dashDb = eventCaps.editorForm ? null : dashboardCategoryToDb(newEventDashboardCategory);
    if (dashDb != null) (payload as any).dashboard_category = dashDb;

    const editorPartyTargeting = eventCaps.editorForm ? buildEditorPartyTargetingFromForm(newParty) : null;
    const partyArr = isCreateCategoryMode
      ? []
      : eventCaps.editorForm && editorPartyTargeting
        ? editorPartyTargeting.party
        : newParty.includes('ALL')
          ? ['ALL']
          : newParty.filter(Boolean);
    const stateArr =
      eventCaps.editorForm || isCreateCategoryMode ? [] : newState.includes('ALL') ? ['ALL'] : newState.filter(Boolean);
    const loksabhaArr = isCreateCategoryMode ? [] : newLoksabha.includes('ALL') ? ['ALL'] : newLoksabha.filter(Boolean);
    const assemblyArr = isCreateCategoryMode ? [] : newAssembly.includes('ALL') ? ['ALL'] : newAssembly.filter(Boolean);
    const targetGroupsArr = isCreateCategoryMode ? [] : newTargetGroups.map((x) => String(x).trim()).filter(Boolean);
    const partyIdArr =
      eventCaps.editorForm && editorPartyTargeting
        ? editorPartyTargeting.party_id
        : toNumArrFromStrIds(partyArr);
    let stateIdArr = toNumArrFromStrIds(stateArr);
    const loksabhaIdArr = toNumArrFromStrIds(loksabhaArr);
    const assemblyIdArr = toNumArrFromStrIds(assemblyArr);

    if (
      eventCaps.campaignManagerForm &&
      targetGroupsArr.length === 0 &&
      loksabhaIdArr.length === 0 &&
      assemblyIdArr.length === 0 &&
      !newLoksabha.includes('ALL') &&
      !newAssembly.includes('ALL') &&
      dashDb == null
    ) {
      alert('Please select at least one Target Group, Lok Sabha, or Assembly.');
      return;
    }

    if (eventCaps.editorForm) {
      stateIdArr = newState.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
      if (stateIdArr.length === 0) {
        alert('Please select at least one state.');
        return;
      }
      const lokIdArr = resolveEditorGeoIdsForPayload(
        newLoksabha,
        availableLoksabhas.map((l) => l.id)
      );
      const asmIdArr = resolveEditorGeoIdsForPayload(
        newAssembly,
        availableAssemblies.map((a) => a.id)
      );
      payload.state_id = stateIdArr;
      payload.loksabha_id = lokIdArr;
      payload.assembly_id = asmIdArr;
      payload.state = [];
      payload.loksabha = [];
      payload.assembly = [];
      payload.target_groups = [];
      payload.party = editorPartyTargeting!.party;
      payload.party_id = editorPartyTargeting!.party_id;
      logEditorTargetingDebug('create_party_targeting', {
        editor_state_scope: stateIdArr,
        selected_party_mode: editorPartyTargeting!.mode,
        all_parties_state_scoped: editorPartyTargeting!.allPartiesStateScoped,
        selected_party: newParty,
        saved_party_payload: { party: payload.party, party_id: payload.party_id },
      });
      logEditorPartyDebug('create_saved_party_payload', {
        editor_allowed_parties: editorAssignableParties.map((p) => p.id),
        selected_party: newParty,
        saved_party_payload: { party: payload.party, party_id: payload.party_id },
      });
    } else if (eventCaps.campaignManagerForm) {
      payload.party = [];
      payload.state = [];
      payload.party_id = [];
      payload.state_id = [];
      payload.loksabha = [];
      payload.assembly = [];
      payload.target_groups = targetGroupsArr;
      payload.loksabha_id = loksabhaIdArr;
      payload.assembly_id = assemblyIdArr;
    } else if (targetGroupsArr.length > 0) {
      // Priority rule: if target_groups is set, it overrides geo filters (store geo arrays empty).
      payload.party = [];
      payload.state = [];
      payload.loksabha = [];
      payload.assembly = [];
      payload.party_id = [];
      payload.state_id = [];
      payload.loksabha_id = [];
      payload.assembly_id = [];
    } else {
      if (partyArr.length > 0) payload.party = partyArr;
      if (stateArr.length > 0) payload.state = stateArr;
      if (loksabhaArr.length > 0) payload.loksabha = loksabhaArr;
      if (assemblyArr.length > 0) payload.assembly = assemblyArr;
      if (partyIdArr.length > 0) payload.party_id = partyIdArr;
      if (stateIdArr.length > 0) payload.state_id = stateIdArr;
      if (loksabhaIdArr.length > 0) payload.loksabha_id = loksabhaIdArr;
      if (assemblyIdArr.length > 0) payload.assembly_id = assemblyIdArr;
    }
    payload.target_groups = targetGroupsArr;
    const res = await fetch('/api/admin/events', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const resp = (await res.json().catch(() => ({}))) as { event?: any; error?: string };
    if (!res.ok) {
      devConsole.error('Insert Error:', resp.error ?? res.status);
      alert('Error: ' + (resp.error || `HTTP ${res.status}`));
      return;
    }
    const data = resp.event;
    if (data?.id == null || String(data.id).trim() === '') {
      alert('Event created but no id was returned — check Supabase RLS and .select() on insert.');
      return;
    }
    const ownerId =
      viewer?.id && viewer.id !== 'viewer' && viewer.id !== 'session'
        ? String(viewer.id)
        : (data as { created_by?: string | null })?.created_by != null
          ? String((data as { created_by?: string | null }).created_by)
          : null;
    const ev: CampaignEvent = {
      id: String(data.id).trim(),
      name: data.name,
      start: data.start ?? startVal,
      end: data.end ?? endVal,
      created_by: ownerId,
      party: partyArr.length ? partyArr : undefined,
      state: stateArr.length ? stateArr : undefined,
      loksabha: loksabhaArr.length ? loksabhaArr : undefined,
      assembly: assemblyArr.length ? assemblyArr : undefined,
      target_groups: targetGroupsArr.length ? targetGroupsArr : undefined,
      dashboard_category: (data as any)?.dashboard_category != null ? ((data as any).dashboard_category as string | null) : dashDb,
      assetsCount: 0,
      posts: [],
      captions: normalizeCaptionsFromDb(data.captions),
    };
    setEvents((prev) => [ev, ...prev]);
    setNewName('');
    setStartDate('');
    setEndDate('');
    setScheduledAt('');
    setScheduleUiOpen(false);
    setNewParty([]);
    setNewState([]);
    setNewLoksabha([]);
    setNewAssembly([]);
    setNewTargetGroups([]);
    setNewEventDashboardCategory('none');
    await openEvent(ev);
    setView('gallery');
  };

  const openEvent = async (ev: CampaignEvent) => {
    const postsQuery = supabase.from('posts').select('id, image_url, title, dashboard_category').eq('category', ev.name);
    const [eventsRes, postsRes] = await Promise.all([
      fetchEventByIdOrName(ev),
      postsQuery.order('created_at', { ascending: false }),
    ]);
    if (eventsRes.error) devConsole.error('openEvent events fetch:', eventsRes.error);
    const eventRow =
      !eventsRes.error && eventsRes.data != null ? (eventsRes.data as unknown as Record<string, unknown>) : null;
    const dbCaptions = normalizeCaptionsFromDb(eventRow?.captions ?? ev.captions);
    const evParty = toStrArr((eventRow?.party as string | string[] | undefined) ?? ev.party);
    const evState = toStrArr((eventRow?.state as string | string[] | undefined) ?? ev.state);
    const evLoksabha = toStrArr((eventRow?.loksabha as string | string[] | undefined) ?? ev.loksabha);
    const evAssembly = toStrArr((eventRow?.assembly as string | string[] | undefined) ?? ev.assembly);
    const evDashCat =
      eventRow && isActiveEventDashboardCategory((eventRow as Record<string, unknown>).dashboard_category)
        ? String((eventRow as Record<string, unknown>).dashboard_category)
        : ev.dashboard_category && isActiveEventDashboardCategory(ev.dashboard_category)
          ? ev.dashboard_category
          : null;
    const evStateId = Array.isArray(eventRow?.state_id)
      ? (eventRow!.state_id as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n))
      : ev.state_id;
    const evWithPartyState = {
      ...ev,
      party: evParty,
      state: evState,
      state_id: evStateId,
      loksabha: evLoksabha,
      assembly: evAssembly,
      dashboard_category: evDashCat,
      created_by: eventRow?.created_by != null ? String(eventRow.created_by) : ev.created_by ?? null,
      created_role: eventRow?.created_role != null ? String(eventRow.created_role) : ev.created_role ?? null,
      status: eventRow?.status != null ? String(eventRow.status) : ev.status ?? null,
    };
    const postsFromDb: Post[] = (postsRes.data || []).map((p: { id: string; image_url: string; title: string; dashboard_category?: unknown }) => ({
      id: p.id,
      url: p.image_url,
      type: 'image' as const,
      name: p.title || '',
      dashboard_category: typeof (p as any).dashboard_category === 'string' ? String((p as any).dashboard_category) : null,
    }));
    const evWithData = { ...evWithPartyState, captions: dbCaptions, posts: postsFromDb, assetsCount: postsFromDb.length };
    setEvents((prev) =>
      prev.map((e) =>
        e.id === ev.id
          ? {
              ...e,
              party: evParty,
              state: evState,
              loksabha: evLoksabha,
              assembly: evAssembly,
              dashboard_category: evDashCat,
              captions: dbCaptions,
              posts: postsFromDb,
              assetsCount: postsFromDb.length,
            }
          : e
      )
    );
    setSelectedEvent(evWithData);
    setView('gallery');
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selectedEvent) return;

    const imageFiles = Array.from(files).filter(
      (f) =>
        f.type === 'image/jpeg' ||
        f.type === 'image/png' ||
        f.name.toLowerCase().endsWith('.jpg') ||
        f.name.toLowerCase().endsWith('.jpeg') ||
        f.name.toLowerCase().endsWith('.png')
    );
    if (imageFiles.length === 0) return;

    const eventSnapshot = selectedEvent;

    /** Always pull latest captions from `events` so new rows match DB (not stale React state). */
    const evCaptionsRes = await fetchEventByIdOrName(eventSnapshot);
    if (evCaptionsRes.error) {
      devConsole.error('[handleUpload] Failed to read events.captions:', evCaptionsRes.error.message, evCaptionsRes.error);
    }
    const capRow =
      !evCaptionsRes.error && evCaptionsRes.data != null
        ? (evCaptionsRes.data as unknown as Record<string, unknown>)
        : null;
    const fromDb = normalizeCaptionsFromDb(capRow?.captions);
    const fromUi = normalizeCaptionsFromDb(eventSnapshot.captions);
    const batchCaptions = fromDb.length > 0 ? fromDb : fromUi;

    const dashFromEvent =
      capRow && isActiveEventDashboardCategory((capRow as Record<string, unknown>).dashboard_category)
        ? String((capRow as Record<string, unknown>).dashboard_category)
        : eventSnapshot.dashboard_category && isActiveEventDashboardCategory(eventSnapshot.dashboard_category)
          ? eventSnapshot.dashboard_category
          : null;
    const isGlobalDashPost = dashFromEvent != null;

    const newPosts: Post[] = [];

    await mediaUploadQueue.enqueueAndRun(imageFiles, async (item, { setProgress, signal }) => {
      const file = item.file;
      const ext = file.name.toLowerCase().endsWith('.jpeg')
        ? '.jpeg'
        : file.name.toLowerCase().endsWith('.png')
          ? '.png'
          : '.jpg';
      const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const storagePath = `public/events/${String(eventSnapshot.id)}/${Date.now()}-${safeName}`;

      const up = await adminStorageUploadWithProgress('post-images', storagePath, file, {
        onProgress: (p) => setProgress(Math.min(88, p)),
        signal,
      });
      const imageUrl = up.publicUrl;

      setProgress(90);

      const scopeRow = capRow ?? {};
      const scopeSource = scopeRow as Record<string, unknown>;
      const eventScopeSource = eventSnapshot as unknown as Record<string, unknown>;
      const postScopeIds = (key: 'party_id' | 'state_id' | 'loksabha_id' | 'assembly_id') => {
        const fromCap = scopeIdsForPostFromRow(scopeSource, key);
        if (fromCap.length > 0 || Object.prototype.hasOwnProperty.call(scopeSource, key)) return fromCap;
        return scopeIdsForPostFromRow(eventScopeSource, key);
      };
      const postPayload: Record<string, unknown> = {
        title: file.name.replace(ext, ''),
        image_url: imageUrl,
        category: eventSnapshot.name,
        event_id: String(eventSnapshot.id),
        dashboard_category: dashFromEvent,
        is_video: false,
        captions: batchCaptions.length > 0 ? captionsJsonForPostColumn(batchCaptions) : batchCaptions,
        party_id: isGlobalDashPost ? [] : postScopeIds('party_id'),
        state_id: isGlobalDashPost ? [] : postScopeIds('state_id'),
        loksabha_id: isGlobalDashPost ? [] : postScopeIds('loksabha_id'),
        assembly_id: isGlobalDashPost ? [] : postScopeIds('assembly_id'),
      };
      const targetGroupsRaw =
        (scopeRow as { target_groups?: string | string[] | null }).target_groups ?? eventSnapshot.target_groups;
      const targetGroupsArr = isGlobalDashPost ? [] : toStrArr(targetGroupsRaw);
      postPayload.target_groups = targetGroupsArr;
      if (targetGroupsArr.length > 0) {
        postPayload.party_id = [];
        postPayload.state_id = [];
        postPayload.loksabha_id = [];
        postPayload.assembly_id = [];
      }

      devConsole.log('[handleUpload] POST /api/admin/posts', {
        event_id: postPayload.event_id,
        role: 'session',
        payload_keys: Object.keys(postPayload),
      });

      const postRes = await fetch('/api/admin/posts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postPayload),
        signal,
      });
      const postJson = (await postRes.json().catch(() => ({}))) as {
        post?: { id?: string };
        error?: string;
        step?: string;
        supabase?: { message?: string; code?: string; details?: string; hint?: string };
        debug?: { trace?: unknown[] };
      };
      if (!postRes.ok) {
        devConsole.error('[handleUpload] POST /api/admin/posts failed', {
          status: postRes.status,
          step: postJson.step,
          error: postJson.error,
          supabase: postJson.supabase,
          debug: postJson.debug,
          event_id: postPayload.event_id,
        });
        const supaMsg = postJson.supabase?.message?.trim();
        const stepTag = postJson.step ? ` [${postJson.step}]` : '';
        throw new Error(
          (postJson.error || `Failed to save post (${postRes.status})`) +
            stepTag +
            (supaMsg ? ` — ${supaMsg}` : '')
        );
      }
      const postId = postJson.post?.id;
      if (postId == null || String(postId).trim() === '') {
        devConsole.error('[handleUpload] post ok but missing id', postJson);
        throw new Error('Post created but no id returned');
      }

      setProgress(100);

      newPosts.push({
        id: String(postId),
        url: imageUrl,
        type: 'image',
        name: file.name,
        dashboard_category: dashFromEvent,
      });

      return { url: imageUrl };
    });

    if (newPosts.length > 0) {
      const updated = events.map((ev) =>
        ev.id === eventSnapshot.id
          ? { ...ev, posts: [...newPosts, ...ev.posts], assetsCount: (ev.assetsCount ?? ev.posts.length) + newPosts.length }
          : ev
      );
      setEvents(updated);
      setSelectedEvent({
        ...eventSnapshot,
        posts: [...newPosts, ...eventSnapshot.posts],
        assetsCount: (eventSnapshot.assetsCount ?? eventSnapshot.posts.length) + newPosts.length,
      });

      const evSnapRes = await fetchEventByIdOrName(eventSnapshot);
      if (evSnapRes.error) devConsole.error('[handleUpload] post-upload events read:', evSnapRes.error.message);
      const snapRow =
        !evSnapRes.error && evSnapRes.data != null
          ? (evSnapRes.data as unknown as Record<string, unknown>)
          : null;
      const snapDb = normalizeCaptionsFromDb(snapRow?.captions);
      const latestCaptions = snapDb.length > 0 ? snapDb : normalizeCaptionsFromDb(eventSnapshot.captions);
      await syncGraphicsPostCaptions(eventSnapshot, latestCaptions);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addCaptionToList = async () => {
    if (!selectedEvent || !newCaptionText.trim()) return;
    const updatedCaptions = [...selectedEvent.captions, newCaptionText.trim()];
    await updateEventByIdOrName(selectedEvent, { captions: updatedCaptions });
    await syncGraphicsPostCaptions(selectedEvent, updatedCaptions);
    const updatedEvents = events.map((ev) =>
      ev.id === selectedEvent.id ? { ...ev, captions: updatedCaptions } : ev
    );
    setEvents(updatedEvents);
    setSelectedEvent({ ...selectedEvent, captions: updatedCaptions });
    setNewCaptionText('');
  };

  const confirmDeleteCaption = async () => {
    if (!selectedEvent || captionToDelete === null) return;
    const updatedCaptions = selectedEvent.captions.filter((_, i) => i !== captionToDelete);
    await updateEventByIdOrName(selectedEvent, { captions: updatedCaptions });
    await syncGraphicsPostCaptions(selectedEvent, updatedCaptions);
    const updatedEvents = events.map((ev) =>
      ev.id === selectedEvent.id ? { ...ev, captions: updatedCaptions } : ev
    );
    setEvents(updatedEvents);
    setSelectedEvent({ ...selectedEvent, captions: updatedCaptions });
    setCaptionToDelete(null);
  };

  const getStoragePathFromUrl = (url: string): string | null => {
    const match = url.match(/\/post-images\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const deleteEvent = async (ev: CampaignEvent) => {
    try {
      // Mark event deleted on the server first. If this fails, do not remove posts or local list
      // (otherwise the event comes back on refresh).
      const delEv = await deleteEventRowByIdOrName(ev);
      if (!delEv.ok) {
        alert(delEv.error);
        return;
      }

      const postsQuery = supabase.from('posts').select('id, image_url').eq('category', ev.name);
      const { data: postsData } = await postsQuery;
      const postsToClean = postsData || [];

      const filePaths: string[] = [];
      for (const p of postsToClean) {
        const path = getStoragePathFromUrl(p.image_url);
        if (path) filePaths.push(path);
      }

      if (filePaths.length > 0) {
        try {
          await adminStorageRemove('post-images', filePaths);
        } catch (storageEx) {
          devConsole.error('Storage delete exception:', storageEx);
        }
      }

      try {
        const delRes = await fetch(
          `/api/admin/posts?category=${encodeURIComponent(ev.name)}`,
          { method: 'DELETE', credentials: 'same-origin' }
        );
        if (!delRes.ok) {
          const d = (await delRes.json().catch(() => ({}))) as { error?: string };
          devConsole.error('Posts delete error:', d.error ?? delRes.status);
        }
      } catch (postsEx) {
        devConsole.error('Posts delete exception:', postsEx);
      }

      setEvents((prev) => prev.filter((e) => e.id !== ev.id));
      if (selectedEvent?.id === ev.id) {
        setView('list');
        setSelectedEvent(null);
      }
    } catch (err) {
      devConsole.error('deleteEvent exception:', err);
    } finally {
      setIsDeleting(null);
    }
  };

  const removePost = async () => {
    if (!selectedEvent || !postToDelete) return;

    const postId = postToDelete.id;
    const postUrl = postToDelete.url;
    const ev = selectedEvent;

    if (!postId || typeof postId !== 'string') {
      devConsole.error('removePost: invalid postToDelete.id', postToDelete);
      return;
    }

    try {
      const delRes = await fetch(`/api/admin/posts?id=${encodeURIComponent(postId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!delRes.ok) {
        const d = (await delRes.json().catch(() => ({}))) as { error?: string };
        devConsole.error('posts table delete error:', d.error ?? delRes.status);
      }
    } catch (dbError) {
      devConsole.error('posts table delete error:', dbError);
    }

    const filePath = getStoragePathFromUrl(postUrl);
    if (filePath) {
      try {
        await adminStorageRemove('post-images', [filePath]);
      } catch (e) {
        devConsole.error('removePost storage:', e);
      }
    }

    const filtered = ev.posts.filter((p) => p.id !== postId);
    const updated = events.map((e) => (e.id === ev.id ? { ...e, posts: filtered } : e));
    setEvents(updated);
    setSelectedEvent({ ...ev, posts: filtered, assetsCount: filtered.length });
    setPostToDelete(null);
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });

  const toDateInputValue = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  };

  const openEditModal = async (ev: CampaignEvent) => {
    if (!canEditEventRow(ev)) return;
    setEditingEvent(ev);
    setEditEventDashboardCategory(dashboardCategoryFromDb(ev.dashboard_category));
    setNewName(ev.name);
    skipLoksabhaResetCountRef.current = 2;
    setStartDate(toDateInputValue(ev.start));
    setEndDate(toDateInputValue(ev.end));

    const listRow = {
      party: ev.party,
      state: ev.state,
      loksabha: ev.loksabha,
      assembly: ev.assembly,
      target_groups: ev.target_groups,
    };
    logEventFormHydration('open_edit_list_snapshot', { event_id: ev.id, listRow });

    const fetchRes = await fetchEventByIdOrName(ev);
    const dbRow =
      !fetchRes.error && fetchRes.data != null
        ? (fetchRes.data as Record<string, unknown>)
        : null;
    logEventFormHydration('open_edit_db_payload', {
      event_id: ev.id,
      dbRow: dbRow ?? null,
      fetchError: fetchRes.error?.message ?? null,
    });

    const source = dbRow ?? (listRow as Record<string, unknown>);
    const partySel = resolvePartySelectionsFromEvent(source, PARTIES_DATA, { forEditor: eventCaps.editorForm });
    const stateIds = resolveStateSelectionsFromEvent(source, availableStates);
    const lokSel = resolveLoksabhaSelectionsFromEvent(source, { forEditor: eventCaps.editorForm });
    const asmSel = resolveAssemblySelectionsFromEvent(source, { forEditor: eventCaps.editorForm });

    logEventFormHydration('open_edit_hydrated_form', {
      event_id: ev.id,
      partySel,
      stateIds,
      lokSel,
      asmSel,
      target_groups: toStrArr(source.target_groups as string | string[] | undefined),
    });
    const hydratedStateScope = resolveStateSelectionsFromEvent(source, availableStates).filter(
      (id) => id !== 'ALL'
    );
    logEditorTargetingDebug('edit_hydrated_party', {
      editor_state_scope: hydratedStateScope.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0),
      selected_party_mode: partySel.includes('ALL') ? 'all_parties_state_scoped' : partySel.length > 0 ? 'specific_parties' : 'none',
      all_parties_state_scoped: partySel.includes('ALL'),
      hydrated_party: partySel,
      db_party_id: source.party_id,
      db_party: source.party,
    });
    logEditorPartyDebug('edit_hydrated_party', {
      editor_allowed_parties: editorAssignableParties.map((p) => p.id),
      hydrated_party: partySel,
      db_party_id: source.party_id,
      db_party: source.party,
    });

    setNewParty(partySel);
    setNewState(stateIds);
    setNewLoksabha(lokSel);
    setNewAssembly(asmSel);
    setNewTargetGroups(toStrArr(source.target_groups as string | string[] | undefined));

    logEventFormHydration('open_edit_rendered_after_set', {
      event_id: ev.id,
      note: 'React state updates async; check moderator effect skipped via isEditMode',
    });
  };

  const handleSaveEvent = async () => {
    if (!newName || !startDate || !endDate || !editingEvent) return;
    if (eventCaps.editorForm && scheduledAt) {
      alert('Editors cannot schedule publish; events are saved as drafts.');
      return;
    }

    const originalName = editingEvent.name;

    const updatePayload: Record<string, unknown> = {
      name: newName.trim(),
      start: `${startDate}T00:00:00Z`,
      end: `${endDate}T23:59:59Z`,
      captions: editingEvent.captions,
      dashboard_category: dashboardCategoryToDb(editEventDashboardCategory),
    };
    if (scheduledAt) {
      const iso = new Date(scheduledAt).toISOString();
      if (iso <= new Date().toISOString()) {
        alert('scheduled_at must be a future date/time');
        return;
      }
      updatePayload.scheduled_at = iso;
    }
    const isEditCat = editEventDashboardCategory !== 'none';
    const editorPartyTargetingEdit = eventCaps.editorForm ? buildEditorPartyTargetingFromForm(newParty) : null;
    const partyArr = isEditCat
      ? []
      : eventCaps.editorForm && editorPartyTargetingEdit
        ? editorPartyTargetingEdit.party
        : newParty.includes('ALL')
          ? ['ALL']
          : newParty.filter(Boolean);
    const stateArr = isEditCat ? [] : newState.includes('ALL') ? ['ALL'] : newState.filter(Boolean);
    const loksabhaArr = isEditCat ? [] : newLoksabha.includes('ALL') ? ['ALL'] : newLoksabha.filter(Boolean);
    const assemblyArr = isEditCat ? [] : newAssembly.includes('ALL') ? ['ALL'] : newAssembly.filter(Boolean);
    const targetGroupsArr = isEditCat ? [] : newTargetGroups.map((x) => String(x).trim()).filter(Boolean);
    const loksabhaIdArr = toNumArrFromStrIds(loksabhaArr);
    const assemblyIdArr = toNumArrFromStrIds(assemblyArr);
    if (
      eventCaps.campaignManagerForm &&
      targetGroupsArr.length === 0 &&
      loksabhaIdArr.length === 0 &&
      assemblyIdArr.length === 0 &&
      !newLoksabha.includes('ALL') &&
      !newAssembly.includes('ALL') &&
      !isEditCat
    ) {
      alert('Please select at least one Target Group, Lok Sabha, or Assembly.');
      return;
    }
    const partyIdArr =
      eventCaps.editorForm && editorPartyTargetingEdit
        ? editorPartyTargetingEdit.party_id
        : toNumArrFromStrIds(partyArr);
    const stateIdArr = toNumArrFromStrIds(stateArr);
    if (eventCaps.editorForm && editorPartyTargetingEdit) {
      const editorStateScope = newState.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
      logEditorTargetingDebug('edit_saved_party_targeting', {
        editor_state_scope: editorStateScope,
        selected_party_mode: editorPartyTargetingEdit.mode,
        all_parties_state_scoped: editorPartyTargetingEdit.allPartiesStateScoped,
        selected_party: newParty,
        saved_party_payload: {
          party: isEditCat ? [] : editorPartyTargetingEdit.party,
          party_id: isEditCat ? [] : editorPartyTargetingEdit.party_id,
        },
      });
      logEditorPartyDebug('edit_saved_party_payload', {
        editor_allowed_parties: editorAssignableParties.map((p) => p.id),
        selected_party: newParty,
        hydrated_party: partyArr,
        saved_party_payload: {
          party: isEditCat ? [] : editorPartyTargetingEdit.party,
          party_id: isEditCat ? [] : editorPartyTargetingEdit.party_id,
        },
      });
    }
    updatePayload.target_groups = targetGroupsArr;
    if (eventCaps.campaignManagerForm) {
      updatePayload.party = [];
      updatePayload.state = [];
      updatePayload.loksabha = [];
      updatePayload.assembly = [];
      updatePayload.party_id = [];
      updatePayload.state_id = [];
      updatePayload.loksabha_id = loksabhaIdArr;
      updatePayload.assembly_id = assemblyIdArr;
    } else if (targetGroupsArr.length > 0) {
      // Priority rule: if target_groups is set, it overrides geo filters (clear geo arrays).
      updatePayload.party = [];
      updatePayload.state = [];
      updatePayload.loksabha = [];
      updatePayload.assembly = [];
      updatePayload.party_id = [];
      updatePayload.state_id = [];
      updatePayload.loksabha_id = [];
      updatePayload.assembly_id = [];
    } else if (eventCaps.editorForm && !isEditCat && editorPartyTargetingEdit) {
      updatePayload.party = editorPartyTargetingEdit.party;
      updatePayload.party_id = editorPartyTargetingEdit.party_id;
      const editorStateIds = newState.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
      updatePayload.state_id = editorStateIds;
      updatePayload.loksabha_id = resolveEditorGeoIdsForPayload(
        newLoksabha,
        availableLoksabhas.map((l) => l.id)
      );
      updatePayload.assembly_id = resolveEditorGeoIdsForPayload(
        newAssembly,
        availableAssemblies.map((a) => a.id)
      );
      updatePayload.state = [];
      updatePayload.loksabha = [];
      updatePayload.assembly = [];
    } else {
      if (partyArr.length > 0) updatePayload.party = partyArr;
      if (stateArr.length > 0) updatePayload.state = stateArr;
      if (loksabhaArr.length > 0) updatePayload.loksabha = loksabhaArr;
      if (assemblyArr.length > 0) updatePayload.assembly = assemblyArr;
      if (partyIdArr.length > 0) updatePayload.party_id = partyIdArr;
      if (stateIdArr.length > 0) updatePayload.state_id = stateIdArr;
      if (loksabhaIdArr.length > 0) updatePayload.loksabha_id = loksabhaIdArr;
      if (assemblyIdArr.length > 0) updatePayload.assembly_id = assemblyIdArr;
    }
    const { error: eventsErr } = await updateEventByIdOrName(editingEvent, updatePayload);

    if (eventsErr) {
      devConsole.error('Full Error Object:', eventsErr);
      alert('Error: ' + eventsErr.message);
      return;
    }

    const targetCategory = newName.trim();
    if (targetCategory !== originalName) {
      await fetch('/api/admin/posts', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: originalName, patch: { category: targetCategory } }),
      });
    }
    const postUpdatePayload: Record<string, unknown> = {};
    postUpdatePayload.target_groups = targetGroupsArr;
    if (targetGroupsArr.length > 0) {
      postUpdatePayload.party = [];
      postUpdatePayload.state = [];
      postUpdatePayload.loksabha = [];
      postUpdatePayload.assembly = [];
      postUpdatePayload.party_id = [];
      postUpdatePayload.state_id = [];
      postUpdatePayload.loksabha_id = [];
      postUpdatePayload.assembly_id = [];
    } else if (eventCaps.editorForm && !isEditCat && editorPartyTargetingEdit) {
      postUpdatePayload.party_id = editorPartyTargetingEdit.party_id;
      postUpdatePayload.state_id = updatePayload.state_id;
      postUpdatePayload.loksabha_id = updatePayload.loksabha_id;
      postUpdatePayload.assembly_id = updatePayload.assembly_id;
      postUpdatePayload.party = editorPartyTargetingEdit.party;
      postUpdatePayload.state = [];
      postUpdatePayload.loksabha = [];
      postUpdatePayload.assembly = [];
    } else {
      if (partyArr.length > 0) postUpdatePayload.party = partyArr;
      if (stateArr.length > 0) postUpdatePayload.state = stateArr;
      if (loksabhaArr.length > 0) postUpdatePayload.loksabha = loksabhaArr;
      if (assemblyArr.length > 0) postUpdatePayload.assembly = assemblyArr;
      if (partyIdArr.length > 0) postUpdatePayload.party_id = partyIdArr;
      if (stateIdArr.length > 0) postUpdatePayload.state_id = stateIdArr;
      if (loksabhaIdArr.length > 0) postUpdatePayload.loksabha_id = loksabhaIdArr;
      if (assemblyIdArr.length > 0) postUpdatePayload.assembly_id = assemblyIdArr;
    }
    if (Object.keys(postUpdatePayload).length > 0) {
      await fetch('/api/admin/posts', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: targetCategory, patch: postUpdatePayload }),
      });
    }

    {
      const nextDash = dashboardCategoryToDb(editEventDashboardCategory);
      await fetch('/api/admin/posts', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: targetCategory, patch: { dashboard_category: nextDash } }),
      });
    }

    /** Edit Event "Save" updates `events.captions` but must also push to `posts.captions` (same as add/delete caption). */
    const evForSync: CampaignEvent = {
      ...editingEvent,
      name: targetCategory,
    };
    const captionsForPosts = normalizeCaptionsFromDb(updatePayload.captions);
    await syncGraphicsPostCaptions(evForSync, captionsForPosts);

    const newStart = `${startDate}T00:00:00Z`;
    const newEnd = `${endDate}T23:59:59Z`;
    const updated: CampaignEvent = {
      ...editingEvent,
      name: targetCategory,
      start: newStart,
      end: newEnd,
      party: targetGroupsArr.length > 0 ? undefined : partyArr.length ? partyArr : undefined,
      state: targetGroupsArr.length > 0 ? undefined : stateArr.length ? stateArr : undefined,
      loksabha: targetGroupsArr.length > 0 ? undefined : loksabhaArr.length ? loksabhaArr : undefined,
      assembly: targetGroupsArr.length > 0 ? undefined : assemblyArr.length ? assemblyArr : undefined,
      target_groups: targetGroupsArr.length ? targetGroupsArr : undefined,
      dashboard_category: dashboardCategoryToDb(editEventDashboardCategory),
    };
    setEvents((prev) => prev.map((ev) => (ev.id === editingEvent.id ? updated : ev)));
    if (selectedEvent?.id === editingEvent.id) {
      const nextDash = dashboardCategoryToDb(editEventDashboardCategory);
      setSelectedEvent({
        ...updated,
        posts: (selectedEvent.posts ?? []).map((p) => ({ ...p, dashboard_category: nextDash })),
      });
    }

    const reopenGallery = selectedEvent?.id === editingEvent.id;
    setEditingEvent(null);
    setNewName('');
    setStartDate('');
    setEndDate('');
    setNewParty([]);
    setNewState([]);
    setNewLoksabha([]);
    setNewAssembly([]);
    setNewTargetGroups([]);
    setEditEventDashboardCategory('none');
    if (reopenGallery) setView('gallery');

    let workerNotifyOk = false;
    try {
      const res = await fetch('/api/notifications/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Naya Graphic Aaya!',
          message: targetCategory,
          broadcast_mode: 'global',
          event_id: null,
          audience_filters: {
            all_workers: true,
          },
          data: { id: String(editingEvent.id) },
        }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok || payload.error) {
        devConsole.error('worker notify:', payload.error ?? res.status);
        alert(
          'Event saved, but worker notification failed: ' + (payload.error || `HTTP ${res.status}`)
        );
      } else {
        workerNotifyOk = true;
      }
    } catch (e) {
      devConsole.error('worker notify:', e);
      alert(
        'Event saved, but worker notification failed: ' + (e instanceof Error ? e.message : String(e))
      );
    }
    if (workerNotifyOk) {
      setWorkerNotifyToast(true);
      window.setTimeout(() => setWorkerNotifyToast(false), 4000);
    }
  };

  // --- VIEW 1: EVENT LIST ---
  if (view === 'list') {
    return (
      <div className="max-w-6xl mx-auto p-4 space-y-8 animate-in fade-in duration-500 text-slate-700">
        {workerNotifyToast ? (
          <div
            className="fixed bottom-8 left-1/2 z-[200] max-w-md -translate-x-1/2 rounded-xl px-5 py-3 text-center text-sm font-bold text-white shadow-lg"
            style={{ backgroundColor: '#25D366' }}
            role="status"
          >
            Sabhi workers ko notification bhej di gayi hai!
          </div>
        ) : null}
        {isDeleting && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
              <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><AlertTriangle size={40} /></div>
              <p className="font-black text-xl text-slate-900">Delete Event?</p>
              <div className="flex gap-4">
                <button onClick={() => setIsDeleting(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
                <button onClick={() => deleteEvent(isDeleting)} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold">Delete</button>
              </div>
            </div>
          </div>
        )}

        {editingEvent && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-3 sm:p-4">
            <div className="bg-white rounded-[40px] max-w-md w-full max-h-[85vh] shadow-2xl animate-in zoom-in-95 border border-slate-100 flex flex-col overflow-hidden">
              <div className="shrink-0 px-4 pt-4 sm:px-5 sm:pt-5 pb-2">
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3"><Pencil size={28} /></div>
                <p className="font-black text-xl text-slate-900">Edit Event</p>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-5 py-2">
                <div className="space-y-4 text-left">
                  <div className="flex flex-col">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Event Name</label>
                    <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Independence Day" className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30" />
                  </div>
                  {!eventCaps.editorForm ? (
                  <div className="flex flex-col">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Dashboard Category</label>
                    <select
                      value={editEventDashboardCategory}
                      onChange={(e) => setEditEventDashboardCategory(e.target.value as UiDashboardCategory)}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30 text-sm"
                    >
                      <option value="none">None</option>
                      <option value="good_morning">Good Morning</option>
                      <option value="good_night">Good Night</option>
                      <option value="motivation">Motivation</option>
                      <option value="devotional">Devotional</option>
                      <option value="birthday_wishes">Birthday Wishes</option>
                    </select>
                    {editEventDashboardCategory !== 'none' ? (
                      <p className="mt-2 text-[10px] font-bold text-slate-500">Category events are global dashboard content events.</p>
                    ) : null}
                  </div>
                  ) : null}
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-1">
                    {!eventCaps.campaignManagerForm ? (
                      <div
                        className={`col-span-2 lg:col-span-3 grid grid-cols-2 lg:grid-cols-2 gap-4 ${
                          editEventDashboardCategory !== 'none' ? 'pointer-events-none opacity-50' : ''
                        }`}
                      >
                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                          {eventCaps.editorForm ? (
                            <MultiSelectDropdown
                              label="State (required)"
                              options={editorAssignableStates}
                              selected={newState}
                              onSelect={setNewState}
                              getValue={(s) => String(s.id)}
                              getLabel={(s) => s.name}
                              showAllOption={false}
                              loading={statesLoading}
                              searchable
                            />
                          ) : hasSingleAssignedState && singleAssignedStateId ? (
                            <div>
                              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">State</span>
                              <div className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-100 font-bold text-slate-800 text-sm">
                                {editStateReadonlyLabel}
                              </div>
                            </div>
                          ) : (
                            <MultiSelectDropdown
                              label="State"
                              options={viewerReady ? editFormStateOptions : []}
                              selected={newState}
                              onSelect={setNewState}
                              getValue={(s) => String(s.id)}
                              getLabel={(s) => s.name}
                              allLabel="All States"
                              showAllOption={eventCaps.showAllStateOption}
                              loading={statesLoading || !viewerReady}
                              searchable
                            />
                          )}
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                          <MultiSelectDropdown
                            label="Party"
                            options={editFormPartyOptions}
                            selected={newParty}
                            onSelect={setNewParty}
                            getValue={(p) => p.id}
                            getLabel={(p) => p.shortName}
                            allLabel="All Parties"
                            showAllOption
                            searchable
                            optionLeading={(p) =>
                              isPartyOtherId(String(p.id)) ? (
                                <Users size={16} className="text-slate-500 shrink-0" aria-hidden />
                              ) : null
                            }
                          />
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                          <MultiSelectDropdown
                            label="Lok Sabha"
                            options={availableLoksabhas}
                            selected={newLoksabha}
                            onSelect={setNewLoksabha}
                            getValue={(l) => l.id}
                            getLabel={(l) => l.name}
                            allLabel={eventCaps.showAllAssignedGeoOption ? 'All Assigned Lok Sabha' : 'All Lok Sabha'}
                            showAllOption={eventCaps.showAllAssignedGeoOption || eventCaps.showAllStateOption}
                            loading={loksabhasLoading}
                            searchable
                          />
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                          <MultiSelectDropdown
                            label="Assembly"
                            options={availableAssemblies}
                            selected={newAssembly}
                            onSelect={setNewAssembly}
                            getValue={(a) => a.id}
                            getLabel={(a) => a.name}
                            allLabel={eventCaps.showAllAssignedGeoOption ? 'All Assigned Assembly' : 'All Assembly'}
                            showAllOption={eventCaps.showAllAssignedGeoOption || eventCaps.showAllStateOption}
                            loading={assembliesLoading}
                            searchable
                          />
                        </div>
                      </div>
                    ) : null}
                    {!eventCaps.editorForm ? (
                    <div className={`rounded-2xl border border-slate-200 bg-white p-3 col-span-2 lg:col-span-3 ${editEventDashboardCategory !== 'none' ? 'pointer-events-none opacity-50' : ''}`}>
                      <MultiSelectDropdown
                        label="Target Groups"
                        options={groupOptions.map((g) => ({ id: g.tag, tag: g.tag, name: g.name || g.tag, count: g.count }))}
                        selected={newTargetGroups}
                        onSelect={setNewTargetGroups}
                        getValue={(g) => g.tag}
                        getLabel={(g) => `${g.name || g.tag} (${g.count})`}
                        showAllOption={false}
                        searchable
                        searchPlaceholder="Search groups…"
                      />
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <p className="text-[10px] font-bold text-slate-400">List comes from Group Management.</p>
                        {newTargetGroups.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setNewTargetGroups([])}
                            className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    ) : null}
                  </div>
                  <div className="flex gap-3">
                    <div className="flex flex-col flex-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Activation</label>
                      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30" />
                    </div>
                    <div className="flex flex-col flex-1">
                      <label className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-1">Expiry</label>
                      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30" />
                    </div>
                  </div>
                  {!eventCaps.editorForm ? (
                  <div className="flex gap-3 mt-4">
                    <div className="flex flex-col flex-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Schedule publish</label>
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30"
                      />
                      <p className="mt-1 text-[10px] font-bold text-slate-400">Leave empty to publish instantly.</p>
                    </div>
                    <div className="flex flex-col justify-end">
                      <button
                        type="button"
                        onClick={() => setScheduledAt('')}
                        className="h-[46px] px-4 rounded-2xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200"
                      >
                        Publish now
                      </button>
                    </div>
                  </div>
                  ) : null}
                </div>
              </div>
              <div className="shrink-0 px-4 sm:px-5 py-4 border-t border-slate-100 bg-white">
                <div className="flex gap-4">
                  <button onClick={() => { setEditingEvent(null); setEditEventDashboardCategory('none'); setNewName(''); setStartDate(''); setEndDate(''); setScheduledAt(''); setScheduleUiOpen(false); setNewParty([]); setNewState([]); setNewLoksabha([]); setNewAssembly([]); setNewTargetGroups([]); }} className="flex-1 py-3 sm:py-4 bg-slate-100 rounded-2xl font-bold text-slate-700">Cancel</button>
                  <button onClick={handleSaveEvent} disabled={!newName.trim() || !startDate || !endDate} className="flex-1 py-3 sm:py-4 bg-blue-600 text-white rounded-2xl font-bold disabled:opacity-30">Save</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Professional Header Card */}
        <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
              <Layers size={28} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-none">Campaign Hub</h1>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">Manage events and Captions</p>
            </div>
          </div>
        </div>

        {/* Global Filter — admin / super_admin only */}
        {canUseGlobalEventFilter ? (
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-slate-600">
              <Filter size={18} className="text-slate-400" />
              <span className="text-xs font-bold uppercase tracking-widest">Global Filter</span>
            </div>
            <select value={filterParty} onChange={e => setFilterParty(e.target.value)} className="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 outline-none font-bold text-slate-800 text-sm">
              <option value="ALL">All Parties</option>
              {PARTIES_DATA.map(p => <option key={p.id} value={p.id}>{p.shortName}</option>)}
            </select>
            {hasSingleAssignedState && singleAssignedStateId ? (
              <div className="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 font-bold text-slate-800 text-sm">
                {visibleStates[0]?.name ?? '—'}
              </div>
            ) : (
              <select value={filterState} onChange={e => setFilterState(e.target.value)} className="bg-slate-50 px-3 py-2 rounded-xl border border-slate-100 outline-none font-bold text-slate-800 text-sm">
                <option value="ALL">All States</option>
                {(viewerReady ? visibleStates : []).map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
              </select>
            )}
          </div>
        ) : null}

        {/* Create Event Strip */}
        <div className="bg-white p-4 rounded-[35px] border border-slate-200 shadow-lg">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 items-end mb-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3 col-span-2 lg:col-span-3">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Event Name</span>
              <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Independence Day" className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-100 outline-none font-bold text-slate-800 text-sm" />
            </div>
            {!eventCaps.editorForm ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-3 col-span-2 lg:col-span-3">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Dashboard Category</span>
                <select
                  value={newEventDashboardCategory}
                  onChange={(e) => setNewEventDashboardCategory(e.target.value as UiDashboardCategory)}
                  className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-100 outline-none font-bold text-slate-800 text-sm"
                >
                  <option value="none">None</option>
                  <option value="good_morning">Good Morning</option>
                  <option value="good_night">Good Night</option>
                  <option value="motivation">Motivation</option>
                  <option value="devotional">Devotional</option>
                  <option value="birthday_wishes">Birthday Wishes</option>
                </select>
                {isCreateCategoryMode ? (
                  <p className="mt-2 text-[10px] font-bold text-slate-500">Category events are global dashboard content events.</p>
                ) : null}
              </div>
            ) : null}
            {!eventCaps.campaignManagerForm ? (
              <div
                className={`col-span-2 lg:col-span-3 grid grid-cols-2 lg:grid-cols-2 gap-4 ${
                  isCreateCategoryMode ? 'pointer-events-none opacity-50' : ''
                }`}
              >
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  {eventCaps.editorForm ? (
                    <MultiSelectDropdown
                      label="State (required)"
                      options={editorAssignableStates}
                      selected={newState}
                      onSelect={setNewState}
                      getValue={(s) => String(s.id)}
                      getLabel={(s) => s.name}
                      showAllOption={false}
                      loading={statesLoading}
                      searchable
                    />
                  ) : hasSingleAssignedState && singleAssignedStateId ? (
                    <div>
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">State</span>
                      <div className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-100 font-bold text-slate-800 text-sm">
                        {visibleStates[0]?.name ?? '—'}
                      </div>
                    </div>
                  ) : (
                    <MultiSelectDropdown
                      label="State"
                      options={viewerReady ? visibleStates : []}
                      selected={newState}
                      onSelect={setNewState}
                      getValue={(s) => String(s.id)}
                      getLabel={(s) => s.name}
                      allLabel="All States"
                      loading={statesLoading || !viewerReady}
                      searchable
                    />
                  )}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <MultiSelectDropdown
                    label="Party"
                    options={eventCaps.editorForm ? editorAssignableParties : PARTIES_DATA}
                    selected={newParty}
                    onSelect={setNewParty}
                    getValue={(p) => p.id}
                    getLabel={(p) => p.shortName}
                    allLabel="All Parties"
                    showAllOption
                    searchable
                    optionLeading={(p) =>
                      isPartyOtherId(String(p.id)) ? (
                        <Users size={16} className="text-slate-500 shrink-0" aria-hidden />
                      ) : null
                    }
                  />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <MultiSelectDropdown
                    label="Lok Sabha"
                    options={availableLoksabhas}
                    selected={newLoksabha}
                    onSelect={setNewLoksabha}
                    getValue={(l) => l.id}
                    getLabel={(l) => l.name}
                    allLabel={eventCaps.showAllAssignedGeoOption ? 'All Assigned Lok Sabha' : 'All Lok Sabha'}
                    showAllOption={eventCaps.showAllAssignedGeoOption || eventCaps.showAllStateOption}
                    loading={loksabhasLoading}
                    searchable
                  />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <MultiSelectDropdown
                    label="Assembly"
                    options={availableAssemblies}
                    selected={newAssembly}
                    onSelect={setNewAssembly}
                    getValue={(a) => a.id}
                    getLabel={(a) => a.name}
                    allLabel={eventCaps.showAllAssignedGeoOption ? 'All Assigned Assembly' : 'All Assembly'}
                    showAllOption={eventCaps.showAllAssignedGeoOption || eventCaps.showAllStateOption}
                    loading={assembliesLoading}
                    searchable
                  />
                </div>
              </div>
            ) : null}
            {eventCaps.campaignManagerForm && !isCreateCategoryMode ? (
              <div className="col-span-2 lg:col-span-3 grid grid-cols-2 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <MultiSelectDropdown
                    label="Lok Sabha (constituency)"
                    options={availableLoksabhas}
                    selected={newLoksabha}
                    onSelect={setNewLoksabha}
                    getValue={(l) => l.id}
                    getLabel={(l) => l.name}
                    allLabel="All Lok Sabha"
                    showAllOption
                    loading={loksabhasLoading}
                    searchable
                  />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <MultiSelectDropdown
                    label="Assembly (constituency)"
                    options={availableAssemblies}
                    selected={newAssembly}
                    onSelect={setNewAssembly}
                    getValue={(a) => a.id}
                    getLabel={(a) => a.name}
                    allLabel="All Assembly"
                    showAllOption
                    loading={assembliesLoading}
                    searchable
                  />
                </div>
              </div>
            ) : null}
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Activation</span>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-100 outline-none font-bold text-xs" />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <span className="text-[9px] font-black text-rose-400 uppercase tracking-widest mb-1">Expiry</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-100 outline-none font-bold text-xs" />
            </div>
            {!eventCaps.editorForm ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Schedule publish</span>
              {!scheduleUiOpen ? (
                <button
                  type="button"
                  onClick={() => setScheduleUiOpen(true)}
                  className="w-full rounded-xl bg-slate-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-100"
                >
                  Schedule Event
                </button>
              ) : (
                <>
                  <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} className="w-full bg-slate-50 p-2.5 rounded-xl border border-slate-100 outline-none font-bold text-xs" />
                  <div className="mt-2 flex justify-end gap-3">
                    <button type="button" onClick={() => setScheduleUiOpen(false)} className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700">
                      Close
                    </button>
                    <button type="button" onClick={() => setScheduledAt('')} className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700">
                      Publish now
                    </button>
                  </div>
                </>
              )}
            </div>
            ) : null}
            {!eventCaps.editorForm ? (
            <div className={`rounded-2xl border border-slate-200 bg-white p-3 col-span-2 lg:col-span-3 ${isCreateCategoryMode ? 'pointer-events-none opacity-50' : ''}`}>
              <MultiSelectDropdown
                label="Target Groups"
                options={groupOptions.map((g) => ({ id: g.tag, tag: g.tag, name: g.name || g.tag, count: g.count }))}
                selected={newTargetGroups}
                onSelect={setNewTargetGroups}
                getValue={(g) => g.tag}
                getLabel={(g) => `${g.name || g.tag} (${g.count})`}
                showAllOption={false}
                searchable
                searchPlaceholder="Search groups…"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-[10px] font-bold text-slate-400">
                  Centralized list from Group Management. If set, targeting overrides geo filters in the app.
                </p>
                {newTargetGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setNewTargetGroups([])}
                    className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            ) : null}
            <div className="col-span-2 lg:col-span-3 flex justify-end">
              <button
                onClick={createEvent}
                disabled={!newName || !startDate || !endDate || (eventCaps.editorForm && newState.length === 0)}
                className="bg-blue-600 text-white px-8 py-2.5 rounded-2xl font-black text-xs hover:bg-slate-900 disabled:opacity-30 transition-all uppercase tracking-widest shrink-0"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-12 pb-20">
          {eventsLoading ? (
            <div className="py-20 text-center text-slate-400 font-bold text-sm">Loading events…</div>
          ) : (
          <>
          {['live', 'soon', 'done'].map(st => {
            const items = events.filter(e => {
              const statusMatch = getStatus(e.start, e.end).id === st;
              const evParties = toStrArr(e.party);
              const evStates = toStrArr(e.state);
              const partyMatch =
                !canUseGlobalEventFilter ||
                filterParty === 'ALL' ||
                evParties.length === 0 ||
                evParties.some((p) => String(p) === filterParty);
              const stateMatch =
                !canUseGlobalEventFilter ||
                filterState === 'ALL' ||
                evStates.length === 0 ||
                evStates.some((s) => String(s) === filterState);
              return statusMatch && partyMatch && stateMatch;
            });
            if (items.length === 0) return null;
            return (
              <div key={st} className="space-y-6">
                <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-3 px-2">
                  <div className={`w-2 h-2 rounded-full ${st === 'live' ? 'bg-green-500 animate-ping' : st === 'soon' ? 'bg-blue-500' : 'bg-slate-300'}`} />
                  {st === 'live' ? 'Active Now' : st === 'soon' ? 'Upcoming' : 'Historical'} ({items.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  {items.map(ev => {
                    const status = getStatus(ev.start, ev.end);
                    return (
                      <div key={ev.id} className="bg-white p-7 rounded-[40px] border border-slate-100 shadow-sm hover:shadow-2xl transition-all group flex flex-col">
                        <div className="flex justify-between items-start mb-6">
                          <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${status.color}`}>
                            {status.label}
                          </span>
                          {(canEditEventRow(ev) || canDeleteEventRow(ev)) ? (
                          <div className={`flex items-center gap-1 transition-all ${eventCaps.editorForm ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            {canEditEventRow(ev) ? (
                              <button type="button" onClick={() => void openEditModal(ev)} className="p-2 text-slate-200 hover:text-blue-600" aria-label="Edit event"><Pencil size={16}/></button>
                            ) : null}
                            {canDeleteEventRow(ev) ? (
                              <button type="button" onClick={() => setIsDeleting(ev)} className="p-2 text-slate-200 hover:text-red-500" aria-label="Delete event"><Trash2 size={16}/></button>
                            ) : null}
                          </div>
                          ) : null}
                        </div>
                        <h4 className="font-black text-slate-900 text-xl mb-1 flex items-center gap-2 flex-wrap">
                          {ev.name}
                        </h4>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-8 flex items-center gap-1.5"><Folder size={12} className="text-blue-500" /> {ev.assetsCount} Assets • {ev.captions.length} Captions</p>
                        {(eventPermissionById.get(String(ev.id))?.canView ||
                          eventPermissionById.get(String(ev.id))?.canUpload) ? (
                        <button 
                          onClick={() => openEvent(ev)}
                          className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:bg-blue-600 transition-all flex items-center justify-center gap-2 shadow-lg"
                        >
                          Manage <ChevronRight size={16} />
                        </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          </>
          )}
        </div>
      </div>
    );
  }

  // --- VIEW 2: GALLERY & CAPTION MANAGER ---
  return (
    <div className="max-w-6xl mx-auto p-4 space-y-8 animate-in slide-in-from-bottom-4 text-slate-700 pb-20">
      {isDeleting ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><AlertTriangle size={40} /></div>
            <p className="font-black text-xl text-slate-900">Delete Event?</p>
            <div className="flex gap-4">
              <button onClick={() => setIsDeleting(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
              <button onClick={() => deleteEvent(isDeleting)} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold">Delete</button>
            </div>
          </div>
        </div>
      ) : null}
      <input type="file" ref={fileInputRef} onChange={handleUpload} multiple accept="image/jpeg,image/png,.jpg,.jpeg,.png" className="hidden" />

      {/* Media Delete Popup */}
      {postToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><Trash2 size={40} /></div>
            <p className="font-black text-2xl text-slate-900">Remove Asset?</p>
            <div className="flex gap-4">
              <button onClick={() => setPostToDelete(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
              <button onClick={removePost} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-xl">Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Caption Delete Popup */}
      {captionToDelete !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-md p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full text-center space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto shadow-inner"><AlertTriangle size={40} /></div>
            <p className="font-black text-xl text-slate-900">Delete Caption?</p>
            <p className="text-slate-400 text-sm font-medium italic">This caption will be removed from the app.</p>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setCaptionToDelete(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-bold">Cancel</button>
              <button onClick={confirmDeleteCaption} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold shadow-xl shadow-red-200">Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <button onClick={() => setView('list')} className="flex items-center gap-2 text-slate-400 hover:text-blue-600 font-black uppercase text-[10px] tracking-[0.2em] transition-all">
          <ArrowLeft size={20} /> Back
        </button>
        <div className="md:text-right flex flex-col items-end gap-2">
          {(selectedEvent && (selectedEventPermissions.canEdit || selectedEventPermissions.canDelete)) ? (
            <div className="flex items-center gap-2">
              {selectedEventPermissions.canEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    void openEditModal(selectedEvent);
                    setView('list');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-blue-300 hover:text-blue-600"
                >
                  <Pencil size={14} /> Edit
                </button>
              ) : null}
              {selectedEventPermissions.canDelete ? (
                <button
                  type="button"
                  onClick={() => setIsDeleting(selectedEvent)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 size={14} /> Delete
                </button>
              ) : null}
            </div>
          ) : null}
          <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none flex items-center gap-3 flex-wrap">
            {selectedEvent?.name}
          </h2>
          <p className="text-[10px] font-bold text-blue-600 uppercase mt-3 flex md:justify-end items-center gap-2">
            <Calendar size={14} /> {selectedEvent && formatDate(selectedEvent.start)} — {selectedEvent && formatDate(selectedEvent.end)}
          </p>
        </div>
      </div>

      {/* --- ASSET SECTION (TOP) --- */}
      <div className="space-y-6">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] px-2 flex items-center gap-2">
            <ImageIcon size={14} className="text-blue-500" /> Media ({selectedEvent?.posts.length})
        </h3>
        <UploadQueuePanel
          items={mediaUploadQueue.items}
          onRetry={(id) => void mediaUploadQueue.retryItem(id)}
          onCancel={mediaUploadQueue.cancelItem}
          onDismissCompleted={mediaUploadQueue.dismissCompleted}
          title="Graphics upload"
        />
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
            {selectedEventPermissions.canUpload ? (
            <div onClick={() => fileInputRef.current?.click()} className="aspect-[9/16] bg-white border-4 border-dashed border-slate-200 rounded-[45px] flex flex-col items-center justify-center text-slate-300 cursor-pointer hover:border-blue-500 hover:bg-blue-50/30 transition-all group active:scale-95">
                <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all mb-4 shadow-inner"><Plus size={32} strokeWidth={3} /></div>
                <p className="font-black uppercase text-[10px] tracking-widest group-hover:text-blue-600">Upload Media</p>
            </div>
            ) : null}

            {selectedEvent?.posts.map((post: Post) => (
            <div key={post.id} className="group animate-in zoom-in-95 relative aspect-[9/16] bg-slate-900 rounded-[45px] overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-500">
                {post.type === 'video' ? <video src={post.url} className="w-full h-full object-cover opacity-80" /> : <img src={post.url} className="w-full h-full object-cover opacity-80" alt="asset" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                {selectedEventPermissions.canUpload ? (
                <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                    <button type="button" onClick={() => setPostToDelete(post)} className="w-10 h-10 bg-rose-500 text-white rounded-2xl flex items-center justify-center shadow-2xl hover:bg-rose-600 active:scale-90 transition-all" aria-label="Remove asset"><Trash2 size={18} /></button>
                </div>
                ) : null}
                <div className="absolute bottom-6 left-6 w-8 h-8 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-xl ring-4 ring-blue-600/20">
                    {post.type === 'video' ? <Video size={14} /> : <ImageIcon size={14} />}
                </div>
            </div>
            ))}
        </div>
      </div>

      {/* --- CAPTION MANAGER (BOTTOM) --- */}
      <div className="bg-white p-8 rounded-[40px] border border-slate-100 shadow-sm space-y-8">
        <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2">
                <MessageSquare size={14} className="text-blue-500" /> Captions
            </h3>
        </div>

        {selectedEventPermissions.canEdit ? (
        <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 flex items-center gap-4 bg-slate-50 p-4 rounded-[25px] border border-slate-100">
                <FileText size={20} className="text-slate-400" />
                <input 
                    type="text" 
                    value={newCaptionText}
                    onChange={(e) => setNewCaptionText(e.target.value)}
                    placeholder="Enter a new caption or slogan…" 
                    className="w-full bg-transparent outline-none font-bold text-slate-800 placeholder:text-slate-300"
                />
            </div>
            <button 
                onClick={addCaptionToList}
                disabled={!newCaptionText.trim()}
                className="bg-slate-900 text-white px-12 rounded-[25px] font-black text-xs hover:bg-blue-600 transition-all uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-20 h-[56px]"
            >
                <PlusCircle size={18} /> Add
            </button>
        </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {selectedEvent?.captions.map((cap, idx) => (
                <div key={idx} className="flex items-center justify-between bg-white border border-slate-100 p-5 rounded-[25px] group hover:border-blue-200 transition-all shadow-sm">
                    <div className="flex items-start gap-4">
                        <span className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-400 shrink-0">{idx + 1}</span>
                        <p className="font-bold text-slate-700 text-sm leading-relaxed">{cap}</p>
                    </div>
                    {selectedEventPermissions.canEdit ? (
                    <button type="button" onClick={() => setCaptionToDelete(idx)} className="p-2.5 text-slate-200 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all opacity-0 group-hover:opacity-100" aria-label="Delete caption">
                        <Trash2 size={16} />
                    </button>
                    ) : null}
                </div>
            ))}
            {selectedEvent?.captions.length === 0 && (
                <div className="col-span-full py-10 text-center bg-slate-50/50 rounded-[30px] border border-dashed border-slate-200">
                    <p className="text-slate-300 font-bold text-xs uppercase tracking-widest">No captions added</p>
                </div>
            )}
        </div>
      </div>

      <div className="flex items-center gap-3 justify-center py-10 text-slate-300 font-bold text-[11px] uppercase tracking-[0.4em]">
        <CheckCircle2 size={14} className="text-emerald-500" /> Active & Synced
      </div>
    </div>
  );
}
