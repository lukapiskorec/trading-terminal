interface HeaderProps {
  date: string; // YYYY-MM-DD
  onDateChange: (date: string) => void;
}

export function Header({ date, onDateChange }: HeaderProps) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-neutral-800 bg-neutral-950 px-4">
      <div className="text-sm text-neutral-400">
        {formatDateLabel(date)}
      </div>
      <input
        type="date"
        value={date}
        onChange={(e) => onDateChange(e.target.value)}
        className="h-8 rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
      />
    </header>
  );
}

function formatDateLabel(date: string): string {
  try {
    return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return date;
  }
}
