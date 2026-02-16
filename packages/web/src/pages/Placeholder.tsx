export function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-1">{title}</h2>
        <p className="text-sm text-neutral-500">Coming soon</p>
      </div>
    </div>
  );
}
