/** A lime marker behind a keyword, the CargoFlow headline device. Use once per headline at most. */
export function Highlight({ children }: { children: React.ReactNode }) {
  return <span className="mark">{children}</span>;
}
