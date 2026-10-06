"use client";

/**
 * Global feedback layer: floating toasts and full-screen confirmation dialogs.
 *
 * ## Why one provider for both
 *
 * Every feedback surface in this app is raised from an event handler — a booking
 * POST, a cancellation DELETE, a failed fetch — and nothing about that handler
 * wants to own a piece of UI. Keeping a `useState` per page for a message,
 * rendering it as an inline paragraph in whatever slot happened to be free, and
 * using `window.confirm()` for destructive actions would mean the outcome's
 * placement is decided once per page, in a dialog that is unstyled, blocks the
 * whole tab, and cannot be tested.
 *
 * Consolidating them means:
 *
 * - a page reports an outcome by calling `toast.success(...)`, so where the
 *   message appears is decided once, not once per page;
 * - `confirm()` returns a `Promise<boolean>` instead of blocking, so the dialog
 *   is a normal React tree that can be styled, animated and unmounted;
 * - both surfaces are rendered from a single fixed-position portal host at the
 *   root of the app, above every page's own stacking context.
 *
 * ## Position
 *
 * Toasts are top-centre, which is the one region no page puts content in: the
 * navigation bar is a fixed strip along the top, and the page bodies all start
 * below it. A bottom-right stack would sit on top of the "Cancel"/"Book Now"
 * buttons this app puts at the bottom of its cards, and a bottom-centre stack
 * would cover the pagination and totals rows.
 *
 * ## Lifetime
 *
 * A toast lives 4 seconds by default, 3 for the shortest informational pills,
 * and is removed from the tree after its exit animation so no invisible node is
 * left intercepting clicks. `duration: 0` pins a toast until it is dismissed or
 * resolved, which is how the in-flight "Processing payment…" state stays put.
 */

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/** Visual family of a toast. Drives colour and the default icon. */
export type ToastVariant = "success" | "error" | "warning" | "info";

/** A toast as the caller asks for it. */
export interface ToastOptions {
	/** Short sentence stating what happened. */
	message: string;
	/** Optional second line with the detail — an error code, an id, an amount. */
	description?: string;
	/**
	 * Milliseconds before automatic dismissal. Defaults to
	 * {@link DEFAULT_TOAST_DURATION_MS}; `0` keeps the toast until it is dismissed
	 * by hand or by {@link ToastHandle.dismiss}.
	 */
	duration?: number;
}

/** A toast that is currently on screen. */
interface ToastRecord extends ToastOptions {
	id: number;
	variant: ToastVariant;
	/** Set while the exit animation runs; the node is dropped afterwards. */
	leaving: boolean;
}

/** Handle returned by {@link ToastApi.show}, letting a caller close its own toast. */
export interface ToastHandle {
	id: number;
	/** Begin the dismissal. Safe to call twice. */
	dismiss: () => void;
}

/** The toast half of the context value. */
export interface ToastApi {
	success: (message: string, options?: Omit<ToastOptions, "message">) => ToastHandle;
	error: (message: string, options?: Omit<ToastOptions, "message">) => ToastHandle;
	warning: (message: string, options?: Omit<ToastOptions, "message">) => ToastHandle;
	info: (message: string, options?: Omit<ToastOptions, "message">) => ToastHandle;
	show: (variant: ToastVariant, options: ToastOptions) => ToastHandle;
	/** Close every toast, e.g. after a navigation. */
	dismissAll: () => void;
}

/** Options for {@link ConfirmApi.confirm}. */
export interface ConfirmOptions {
	/** Dialog heading. Keep it a question or a statement of consequence. */
	title: string;
	/** The body copy: what will happen, and what cannot be undone. */
	description?: ReactNode;
	/** Extra consequence list rendered under the description. */
	points?: string[];
	/** Label of the confirming button. Defaults to `"Confirm"`. */
	confirmLabel?: string;
	/** Label of the dismissing button. Defaults to `"Go back"`. */
	cancelLabel?: string;
	/**
	 * `"danger"` paints the confirm button red and is the default for anything
	 * irreversible. `"primary"` is for a confirmation that is not destructive.
	 */
	tone?: "danger" | "primary";
}

/** The dialog half of the context value. */
export interface ConfirmApi {
	/** Resolves `true` when the user confirms, `false` on cancel or Escape. */
	confirm: (options: ConfirmOptions) => Promise<boolean>;
}

/** Everything {@link useFeedback} exposes. */
export type FeedbackApi = ToastApi & ConfirmApi;

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Default time on screen. Long enough to read one line twice. */
export const DEFAULT_TOAST_DURATION_MS = 4000;

/** Shorter lifetime for the informational pills. */
export const SHORT_TOAST_DURATION_MS = 3000;

/** Length of the exit animation in `globals.css` (`.animate-toast-out`). */
const EXIT_ANIMATION_MS = 200;

/** Maximum toasts stacked at once; the oldest is dropped beyond this. */
const MAX_VISIBLE_TOASTS = 4;

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

const FeedbackContext = createContext<FeedbackApi | null>(null);

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

/** One dialog request plus the resolver waiting on the user's answer. */
interface ConfirmRequest {
	options: ConfirmOptions;
	resolve: (confirmed: boolean) => void;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<ToastRecord[]>([]);
	const [dialog, setDialog] = useState<ConfirmRequest | null>(null);

	/** Ids are monotonic so React keys stay stable across a dismissal. */
	const nextId = useRef(1);
	/** Timers, so unmounting the provider cannot leave one firing. */
	const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

	const clearTimer = useCallback((id: number) => {
		const timer = timers.current.get(id);
		if (timer !== undefined) {
			clearTimeout(timer);
			timers.current.delete(id);
		}
	}, []);

	/**
	 * Start the exit animation, then drop the node.
	 *
	 * Removing it in one step would cut the fade short; leaving it in the tree
	 * forever would keep a full-width element over the top of the page swallowing
	 * clicks. `leaving` is the render state that holds the node for exactly as long
	 * as the fade lasts.
	 */
	const dismiss = useCallback(
		(id: number) => {
			clearTimer(id);
			setToasts((current) =>
				current.map((toast) =>
					toast.id === id ? { ...toast, leaving: true } : toast
				)
			);
			const removal = setTimeout(() => {
				timers.current.delete(id);
				setToasts((current) => current.filter((toast) => toast.id !== id));
			}, EXIT_ANIMATION_MS);
			timers.current.set(id, removal);
		},
		[clearTimer]
	);

	const show = useCallback<ToastApi["show"]>(
		(variant, options): ToastHandle => {
			const id = nextId.current;
			nextId.current += 1;

			const duration = options.duration ?? DEFAULT_TOAST_DURATION_MS;
			setToasts((current) => {
				const next = [
					...current,
					{ ...options, id, variant, leaving: false },
				];
				// Drop the oldest visible toast rather than refusing the newest:
				// the newest is the one the user just triggered.
				return next.length > MAX_VISIBLE_TOASTS
					? next.slice(next.length - MAX_VISIBLE_TOASTS)
					: next;
			});

			if (duration > 0) {
				timers.current.set(
					id,
					setTimeout(() => dismiss(id), duration)
				);
			}

			return { id, dismiss: () => dismiss(id) };
		},
		[dismiss]
	);

	const dismissAll = useCallback(() => {
		for (const id of [...timers.current.keys()]) {
			clearTimer(id);
		}
		setToasts([]);
	}, [clearTimer]);

	// A pending timer that fires after unmount would set state on a dead tree.
	useEffect(() => {
		const pending = timers.current;
		return () => {
			for (const timer of pending.values()) {
				clearTimeout(timer);
			}
			pending.clear();
		};
	}, []);

	const toastApi = useMemo<ToastApi>(
		() => ({
			show,
			success: (message, options) => show("success", { message, ...options }),
			error: (message, options) => show("error", { message, ...options }),
			warning: (message, options) => show("warning", { message, ...options }),
			info: (message, options) => show("info", { message, ...options }),
			dismissAll,
		}),
		[show, dismissAll]
	);

	/**
	 * Ask the user to confirm something.
	 *
	 * A second request while one is open resolves the first as `false` — the
	 * alternative is two dialogs stacked on one overlay, where the answer to the
	 * question underneath is unreachable and its promise never settles.
	 */
	const confirm = useCallback<ConfirmApi["confirm"]>(
		(options) =>
			new Promise<boolean>((resolve) => {
				setDialog((current) => {
					current?.resolve(false);
					return { options, resolve };
				});
			}),
		[]
	);

	const value = useMemo<FeedbackApi>(
		() => ({ ...toastApi, confirm }),
		[toastApi, confirm]
	);

	/** Settle the open dialog, if any, and clear it. */
	const answerDialog = useCallback(
		(confirmed: boolean) => {
			setDialog((current) => {
				current?.resolve(confirmed);
				return null;
			});
		},
		[]
	);

	return (
		<FeedbackContext.Provider value={value}>
			{children}
			<ToastViewport toasts={toasts} onDismiss={dismiss} />
			{dialog !== null && (
				<ConfirmDialog
					options={dialog.options}
					onConfirm={() => answerDialog(true)}
					onCancel={() => answerDialog(false)}
				/>
			)}
		</FeedbackContext.Provider>
	);
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Access the feedback layer.
 *
 * Throws outside `FeedbackProvider`, matching `useTheme`: a page that renders its
 * own silently-broken notification is worse than one that fails loudly during
 * development.
 */
export function useFeedback(): FeedbackApi {
	const context = useContext(FeedbackContext);
	if (context === null) {
		throw new Error("useFeedback must be used within a FeedbackProvider");
	}
	return context;
}

/* -------------------------------------------------------------------------- */
/* Toast presentation                                                         */
/* -------------------------------------------------------------------------- */

/** Per-variant colours. Every pair clears AA on its own surface. */
const TOAST_STYLES: Record<
	ToastVariant,
	{
		accent: string;
		panel: string;
		title: string;
		icon: ReactNode;
	}
> = {
	success: {
		accent: "bg-emerald-500",
		panel:
			"border-emerald-200 bg-white dark:border-emerald-500/30 dark:bg-zinc-800",
		title: "text-emerald-800 dark:text-emerald-300",
		icon: (
			<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
				<path
					fillRule="evenodd"
					d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
					clipRule="evenodd"
				/>
			</svg>
		),
	},
	error: {
		accent: "bg-red-500",
		panel: "border-red-200 bg-white dark:border-red-500/30 dark:bg-zinc-800",
		title: "text-red-800 dark:text-red-300",
		icon: (
			<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
				<path
					fillRule="evenodd"
					d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
					clipRule="evenodd"
				/>
			</svg>
		),
	},
	warning: {
		accent: "bg-amber-500",
		panel:
			"border-amber-200 bg-white dark:border-amber-500/30 dark:bg-zinc-800",
		title: "text-amber-800 dark:text-amber-300",
		icon: (
			<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
				<path
					fillRule="evenodd"
					d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z"
					clipRule="evenodd"
				/>
			</svg>
		),
	},
	info: {
		accent: "bg-blue-500",
		panel: "border-blue-200 bg-white dark:border-blue-500/30 dark:bg-zinc-800",
		title: "text-blue-800 dark:text-blue-300",
		icon: (
			<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
				<path
					fillRule="evenodd"
					d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
					clipRule="evenodd"
				/>
			</svg>
		),
	},
};

/**
 * The fixed stack of toasts.
 *
 * `pointer-events-none` on the container and `pointer-events-auto` on each toast
 * is what keeps the full-width strip from blocking the page beneath it: only the
 * toast cards themselves are clickable.
 *
 * `aria-live="polite"` rather than `"assertive"`: these messages report the
 * result of something the user just did, so interrupting whatever the screen
 * reader is already saying is not an improvement.
 */
function ToastViewport({
	toasts,
	onDismiss,
}: {
	toasts: ToastRecord[];
	onDismiss: (id: number) => void;
}) {
	if (toasts.length === 0) {
		return null;
	}

	return (
		<div
			className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4"
			role="region"
			aria-label="Notifications"
		>
			<div aria-live="polite" aria-atomic="false" className="contents">
				{toasts.map((toast) => (
					<ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
				))}
			</div>
		</div>
	);
}

function ToastCard({
	toast,
	onDismiss,
}: {
	toast: ToastRecord;
	onDismiss: (id: number) => void;
}) {
	const style = TOAST_STYLES[toast.variant];
	const duration = toast.duration ?? DEFAULT_TOAST_DURATION_MS;

	return (
		<div
			className={`pointer-events-auto w-full max-w-md overflow-hidden rounded-xl border shadow-lg ${
				style.panel
			} ${toast.leaving ? "animate-toast-out" : "animate-toast-in"}`}
			role={toast.variant === "error" ? "alert" : "status"}
		>
			<div className="flex items-start gap-3 p-3.5">
				<span className={`mt-0.5 h-5 w-5 shrink-0 ${style.title}`}>
					{style.icon}
				</span>
				<div className="min-w-0 flex-1">
					<p className={`text-sm font-semibold ${style.title}`}>
						{toast.message}
					</p>
					{toast.description !== undefined && toast.description.length > 0 && (
						<p className="mt-0.5 text-sm break-words muted">{toast.description}</p>
					)}
				</div>
				<button
					type="button"
					onClick={() => onDismiss(toast.id)}
					aria-label="Dismiss notification"
					className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-black/5 hover:text-gray-700 dark:text-zinc-500 dark:hover:bg-white/10 dark:hover:text-zinc-200"
				>
					<svg
						viewBox="0 0 20 20"
						fill="currentColor"
						className="h-4 w-4"
						aria-hidden="true"
					>
						<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
					</svg>
				</button>
			</div>
			{/*
			 * The lifetime bar is decorative: the auto-dismiss is scheduled in the
			 * provider, and this only visualises it. A pinned toast has no bar
			 * because it has no deadline.
			 */}
			{duration > 0 && !toast.leaving && (
				<span
					className={`toast-lifetime block h-0.5 ${style.accent}`}
					style={{ animationDuration: `${duration}ms` }}
					aria-hidden="true"
				/>
			)}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/* Confirmation dialog                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Full-screen confirmation dialog.
 *
 * Three accessibility details, all of which `window.confirm()` gave for free and
 * a hand-rolled dialog has to reimplement:
 *
 * 1. `role="dialog"` with `aria-modal`, so assistive technology does not read the
 *    page behind it as available.
 * 2. Escape cancels, and the cancel button takes focus on mount, so a keyboard
 *    user lands on the non-destructive choice.
 * 3. The confirm button is not the default focus target, because every use of
 *    this dialog is irreversible.
 */
function ConfirmDialog({
	options,
	onConfirm,
	onCancel,
}: {
	options: ConfirmOptions;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	const danger = (options.tone ?? "danger") === "danger";
	const cancelRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		cancelRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCancel();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onCancel]);

	return (
		<div
			className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto p-4 backdrop animate-overlay-in"
			/*
			 * A click on the overlay itself dismisses; one that started inside the
			 * panel and ended on the overlay (a text selection dragged past the
			 * edge) must not, or a slip of the mouse would cancel a booking.
			 */
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) {
					onCancel();
				}
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="confirm-dialog-title"
				className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl animate-panel-in dark:border-white/10 dark:bg-zinc-800"
			>
				<div className="flex items-start gap-4 p-6">
					<span
						className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
							danger
								? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
								: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400"
						}`}
						aria-hidden="true"
					>
						<svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
							<path
								fillRule="evenodd"
								d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a1 1 0 100-2 1 1 0 000 2z"
								clipRule="evenodd"
							/>
						</svg>
					</span>
					<div className="min-w-0 flex-1">
						<h2
							id="confirm-dialog-title"
							className="text-lg font-semibold heading"
						>
							{options.title}
						</h2>
						{options.description !== undefined && (
							<div className="mt-2 text-sm muted">{options.description}</div>
						)}
						{options.points !== undefined && options.points.length > 0 && (
							<ul className="mt-3 space-y-1.5">
								{options.points.map((point) => (
									<li
										key={point}
										className="flex gap-2 text-sm muted"
									>
										<span
											className="mt-2 h-1 w-1 shrink-0 rounded-full bg-current"
											aria-hidden="true"
										/>
										<span>{point}</span>
									</li>
								))}
							</ul>
						)}
					</div>
				</div>

				<div className="flex flex-col-reverse gap-2 border-t border-gray-200 bg-gray-50 p-4 sm:flex-row sm:justify-end dark:border-white/10 dark:bg-black/20">
					<button
						type="button"
						ref={cancelRef}
						onClick={onCancel}
						className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-100 dark:border-white/15 dark:bg-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-600"
					>
						{options.cancelLabel ?? "Go back"}
					</button>
					<button
						type="button"
						onClick={onConfirm}
						className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${
							danger
								? "bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500"
								: "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500"
						}`}
					>
						{options.confirmLabel ?? "Confirm"}
					</button>
				</div>
			</div>
		</div>
	);
}
