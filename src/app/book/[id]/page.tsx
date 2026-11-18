"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BookViewer } from "@/components/BookViewer";
import { Page, TopNav } from "@/components/ui";
import { api } from "@/lib/api";
import type { BookInfo } from "@/server/book-read";

export default function BookPage() {
  const { id } = useParams<{ id: string }>();
  const [start, setStart] = useState<number | null>(null);
  const [info, setInfo] = useState<BookInfo | null>(null);

  useEffect(() => {
    setStart(Number(new URLSearchParams(window.location.search).get("page")) || 1);
    api<BookInfo>(`/api/books/${id}`).then(setInfo).catch(() => {});
  }, [id]);

  // The address follows the page, so a reload or a shared link opens the same place.
  const onPage = useCallback((p: number) => window.history.replaceState(null, "", `/book/${id}?page=${p}`), [id]);

  return (
    <>
      <TopNav
        tab={info?.name ?? "Книга"}
        icon="book"
        crumbs={[...(info?.semesterId ? [{ label: "Семестр", href: `/semester/${info.semesterId}` }] : []), { label: info?.name ?? "Книга" }]}
      />
      <Page>{start !== null && <BookViewer bookId={Number(id)} page={start} outline onPage={onPage} />}</Page>
    </>
  );
}
