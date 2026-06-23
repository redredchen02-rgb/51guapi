import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { AppLayout } from "@/components/layout/AppLayout";
import { Toaster } from "@/components/ui/sonner";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			retry: 1,
		},
	},
});

export const Route = createRootRoute({
	component: () => (
		<QueryClientProvider client={queryClient}>
			<AppLayout>
				<Outlet />
			</AppLayout>
			<Toaster />
		</QueryClientProvider>
	),
});
