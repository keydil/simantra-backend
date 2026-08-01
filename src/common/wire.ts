import {
  AnalyticsDaily,
  Announcement,
  GuestBookEntry,
  Queue,
  QueueEntry,
  Sponsor,
  Tenant,
  TenantTheme,
  TenantUser,
  VisitPurpose,
} from '@prisma/client';

/**
 * Serializer respons API → snake_case, meniru bentuk row Supabase/PostgREST
 * yang sudah dipakai frontend (lib/supabase/types.ts) supaya migrasi hook
 * tinggal ganti transport, bukan ganti nama field. passwordHash & kolom
 * sensitif lain tidak pernah ikut — whitelist by construction.
 */

export function toWireUser(u: TenantUser & { tenant?: (Tenant & { theme?: TenantTheme | null }) | null }) {
  return {
    id: u.id,
    tenant_id: u.tenantId,
    email: u.email,
    full_name: u.fullName,
    role: u.role,
    is_active: u.isActive,
    must_change_password: u.mustChangePassword,
    last_login: u.lastLogin,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
    ...(u.tenant !== undefined ? { tenant: u.tenant ? toWireTenant(u.tenant) : null } : {}),
  };
}

export function toWireTenant(t: Tenant & { theme?: TenantTheme | null }) {
  return {
    id: t.id,
    name: t.name,
    subdomain: t.subdomain,
    description: t.description,
    logo_url: t.logoUrl,
    brand_color: t.brandColor,
    is_active: t.isActive,
    subscription_tier: t.subscriptionTier,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    ...(t.theme !== undefined ? { theme: t.theme ? toWireTheme(t.theme) : null } : {}),
  };
}

export function toWireQueue(q: Queue) {
  return {
    id: q.id,
    tenant_id: q.tenantId,
    name: q.name,
    description: q.description,
    display_name: q.displayName,
    service_code: q.serviceCode,
    color_code: q.colorCode,
    is_active: q.isActive,
    max_capacity: q.maxCapacity,
    estimated_service_time_minutes: q.estimatedServiceTimeMinutes,
    created_at: q.createdAt,
    updated_at: q.updatedAt,
  };
}

export function toWireVisitPurpose(p: VisitPurpose) {
  return {
    id: p.id,
    tenant_id: p.tenantId,
    label: p.label,
    sort_order: p.sortOrder,
    is_active: p.isActive,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export function toWireSponsor(s: Sponsor) {
  return {
    id: s.id,
    tenant_id: s.tenantId,
    image_url: s.imageUrl,
    name: s.name,
    sort_order: s.sortOrder,
    is_active: s.isActive,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

/** Bentuk penuh — untuk staff & pemegang tiket (UUID = capability). */
export function toWireEntry(e: QueueEntry) {
  return {
    id: e.id,
    queue_id: e.queueId,
    tenant_id: e.tenantId,
    ticket_number: e.ticketNumber,
    customer_name: e.customerName,
    status: e.status,
    service_window: e.serviceWindow,
    priority: e.priority,
    entered_at: e.enteredAt,
    started_at: e.startedAt,
    completed_at: e.completedAt,
    notes: e.notes,
  };
}

/** Bentuk publik (TV display/kiosk) — TANPA customer_name & notes (§4.8). */
export function toWirePublicEntry(e: QueueEntry) {
  return {
    id: e.id,
    queue_id: e.queueId,
    tenant_id: e.tenantId,
    ticket_number: e.ticketNumber,
    status: e.status,
    service_window: e.serviceWindow,
    entered_at: e.enteredAt,
    started_at: e.startedAt,
    completed_at: e.completedAt,
  };
}

export function toWireAnnouncement(a: Announcement) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    announcement_type: a.announcementType,
    target_tenants: a.targetTenants,
    specific_tenant_ids: a.specificTenantIds,
    is_active: a.isActive,
    priority: a.priority,
    published_at: a.publishedAt,
    expires_at: a.expiresAt,
    created_by: a.createdBy,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

/** Subset publik announcement — untuk display board (§4.6). */
export function toWirePublicAnnouncement(a: Announcement) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    announcement_type: a.announcementType,
    priority: a.priority,
    published_at: a.publishedAt,
    expires_at: a.expiresAt,
  };
}

export function toWireGuestBookEntry(g: GuestBookEntry) {
  return {
    id: g.id,
    tenant_id: g.tenantId,
    name: g.name,
    institution: g.institution,
    purpose: g.purpose,
    phone: g.phone,
    photo_url: g.photoUrl,
    created_at: g.createdAt,
  };
}

export function toWireAnalytics(a: AnalyticsDaily) {
  return {
    id: a.id,
    tenant_id: a.tenantId,
    queue_id: a.queueId,
    date: a.date,
    total_entries: a.totalEntries,
    completed_entries: a.completedEntries,
    no_show_entries: a.noShowEntries,
    cancelled_entries: a.cancelledEntries,
    average_service_time_minutes: a.averageServiceTimeMinutes,
    peak_hour: a.peakHour,
    peak_count: a.peakCount,
    created_at: a.createdAt,
  };
}

export function toWireTheme(th: TenantTheme) {
  return {
    id: th.id,
    tenant_id: th.tenantId,
    primary_color: th.primaryColor,
    secondary_color: th.secondaryColor,
    accent_color: th.accentColor,
    text_color: th.textColor,
    background_color: th.backgroundColor,
    logo_url: th.logoUrl,
    favicon_url: th.faviconUrl,
    video_url: th.videoUrl,
    image_url: th.imageUrl,
    queue_view_seconds: th.queueViewSeconds,
    media_view_seconds: th.mediaViewSeconds,
    running_text: th.runningText,
    custom_css: th.customCss,
    is_custom_theme: th.isCustomTheme,
    header_mode: th.headerMode,
    header_wordmark_url: th.headerWordmarkUrl,
    display_background_mode: th.displayBackgroundMode,
    display_background_url: th.displayBackgroundUrl,
    header_title_font: th.headerTitleFont,
    header_title_bold: th.headerTitleBold,
    header_subtitle_text: th.headerSubtitleText,
    header_subtitle_font: th.headerSubtitleFont,
    header_subtitle_bold: th.headerSubtitleBold,
    header_subtitle_size: th.headerSubtitleSize,
    header_subtitle_color: th.headerSubtitleColor,
    created_at: th.createdAt,
    updated_at: th.updatedAt,
  };
}
