'use client';                                // <-- add if you’re on Next.js App Router

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { supabase } from '@/lib/supabase';   // adjust the path if your file lives elsewhere

type Props = { slug: string };               // slug = trend.slug (e.g. "prp-for-dark-spots")

export function Comments({ slug }: Props) {
  const qc = useQueryClient();

  /* 1️⃣  fetch comments for this trend */
  const { data: comments, isLoading, error } = useQuery({
    queryKey: ['comments', slug],
    queryFn: async () =>
      supabase
        .from('comments')
        .select('*')
        .eq('verdict_slug', slug)
        .order('created_at', { ascending: false })
        .then(r => r.data ?? []),
  });

  /* 2️⃣  post a new comment */
  const { register, handleSubmit, reset } = useForm<{ body: string }>();
  const post = useMutation({
    mutationFn: ({ body }: { body: string }) =>
      supabase.from('comments').insert({ verdict_slug: slug, body }),
    onSuccess: () => {
      reset();
      qc.invalidateQueries({ queryKey: ['comments', slug] });
    },
  });

  /* 3️⃣  UI */
  return (
    <section className="mt-10">
      <h3 className="text-lg font-semibold mb-4">Comments</h3>

      {/* form */}
      <form onSubmit={handleSubmit(post.mutate)} className="flex flex-col gap-2 mb-6">
        <textarea
          {...register('body', { required: true })}
          className="w-full border rounded-lg p-3 resize-y"
          placeholder="Share your experience or ask a question…"
        />
        <button
          disabled={post.isPending}
          className="self-end bg-indigo-600 hover:bg-indigo-700 text-white rounded-md px-4 py-2 disabled:opacity-50"
        >
          {post.isPending ? 'Posting…' : 'Post'}
        </button>
      </form>

      {/* list */}
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-600">Couldn’t load comments.</p>}

      {!isLoading && !error && (
        <div className="space-y-4">
          {comments.length ? (
            comments.map(c => (
              <article key={c.id} className="border rounded-lg p-4 bg-white/40 backdrop-blur">
                <p className="whitespace-pre-wrap">{c.body}</p>
                <span className="block text-xs text-muted-foreground mt-2">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </article>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Be the first to comment.</p>
          )}
        </div>
      )}
    </section>
  );
}
