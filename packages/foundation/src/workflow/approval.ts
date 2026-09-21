export type ApprovalHandler = (message: string) => Promise<boolean>;

export const autoApprove: ApprovalHandler = async () => true;
