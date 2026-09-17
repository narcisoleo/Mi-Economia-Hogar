import { MovementForm } from "@/components/movement-form";

export const instant = false;

type EditarMovimientoPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarMovimientoPage({
  params,
}: EditarMovimientoPageProps) {
  const { id } = await params;
  return <MovementForm mode="edit" transactionId={id} />;
}
