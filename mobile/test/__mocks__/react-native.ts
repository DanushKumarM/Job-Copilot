export const Platform = {
  OS: 'android',
  select: (obj: any) => obj.android || obj.default,
};
