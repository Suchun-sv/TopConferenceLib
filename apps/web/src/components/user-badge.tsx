import { getAccessEmail, getOrCreateUser } from "@/lib/auth";

export async function UserBadge() {
  const accessEmail = await getAccessEmail();
  if (!accessEmail) {
    return (
      <span
        className="hidden text-xs text-zinc-400 sm:inline"
        title="No Cloudflare Access identity on this request"
      >
        guest
      </span>
    );
  }
  // Provision the user row on first sight; we don't need the id here, but
  // doing it from the badge means every authenticated visit refreshes lastSeenAt.
  const user = await getOrCreateUser();
  const initial = user.email[0]?.toUpperCase() ?? "?";
  return (
    <div className="flex items-center gap-2 text-sm" title={user.email}>
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-xs font-medium text-white">
        {initial}
      </span>
      <span className="hidden max-w-[180px] truncate text-zinc-700 sm:inline">
        {user.email}
      </span>
    </div>
  );
}
