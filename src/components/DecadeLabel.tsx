// renders "1960" with a small faded "s" suffix
export default function DecadeLabel({ decade }: { decade: string }) {
  const num = decade.replace(/s$/i, "");
  return (
    <>
      {num}<span className="text-[7px] opacity-50">s</span>
    </>
  );
}