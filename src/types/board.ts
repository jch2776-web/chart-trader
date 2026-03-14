export interface BoardPost {
  id: string;
  author: string;
  title: string;
  content: string;          // body text
  tickers: string[];
  drawingsJson: string;
  createdAt: number;        // ms epoch
  updatedAt?: number;       // ms epoch, set on edit
  commentCount: number;
  views: number;
  likes: number;
  dislikes: number;
}

export interface BoardComment {
  id: string;
  author: string;
  text: string;
  createdAt: number;        // ms epoch
  updatedAt?: number;       // ms epoch, set on edit
}
