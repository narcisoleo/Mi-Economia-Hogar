export type BalanceMovement = {
  transaction_date: string;
  amount: number | string;
  transaction_type: string;
  account_id: string | null;
  destination_account_id: string | null;
  economic_destination?: string | null;
  merchant?: string | null;
};

export function movementEffectForAccount(
  movement: BalanceMovement,
  accountId: string
) {
  const amount = Number(movement.amount) || 0;

  if (movement.transaction_type === "income" && movement.account_id === accountId) {
    return amount;
  }

  if (movement.transaction_type === "expense" && movement.account_id === accountId) {
    return -amount;
  }

  if (movement.transaction_type === "transfer") {
    let effect = 0;
    if (movement.account_id === accountId) effect -= amount;
    if (movement.destination_account_id === accountId) effect += amount;
    return effect;
  }

  if (movement.transaction_type === "adjustment" && movement.account_id === accountId) {
    // Compatibilidad con v1.5/v1.5.1 si alguna conciliación llegó a guardarse.
    if (movement.economic_destination === "balance_dec") return -amount;
    if (movement.economic_destination === "balance_inc") return amount;

    // Desde v1.5.2 el signo se guarda en merchant para no depender de
    // valores personalizados en economic_destination.
    if ((movement.merchant ?? "").trim().endsWith("-")) return -amount;
    return amount;
  }

  return 0;
}

export function calculateAccountBalance(
  movements: BalanceMovement[],
  accountId: string,
  throughDate?: string
) {
  return movements.reduce((total, movement) => {
    if (throughDate && movement.transaction_date > throughDate) {
      return total;
    }
    return total + movementEffectForAccount(movement, accountId);
  }, 0);
}
