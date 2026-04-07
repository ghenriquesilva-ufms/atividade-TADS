export class PriorityQueue {
  constructor() {
    this.items = [];
    this.sequence = 0;
  }

  push(value, priority = 1) {
    const node = { value, priority, sequence: this.sequence++ };
    this.items.push(node);
    this.#heapifyUp();
  }

  pop() {
    if (this.items.length === 0) {
      return null;
    }

    if (this.items.length === 1) {
      return this.items.pop().value;
    }

    const root = this.items[0];
    this.items[0] = this.items.pop();
    this.#heapifyDown();
    return root.value;
  }

  get size() {
    return this.items.length;
  }

  #compare(a, b) {
    if (a.priority !== b.priority) {
      return a.priority < b.priority;
    }
    return a.sequence < b.sequence;
  }

  #heapifyUp() {
    let index = this.items.length - 1;

    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (this.#compare(this.items[parentIndex], this.items[index])) {
        break;
      }

      [this.items[parentIndex], this.items[index]] = [
        this.items[index],
        this.items[parentIndex]
      ];
      index = parentIndex;
    }
  }

  #heapifyDown() {
    let index = 0;

    while (true) {
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      let candidate = index;

      if (
        left < this.items.length &&
        this.#compare(this.items[left], this.items[candidate])
      ) {
        candidate = left;
      }

      if (
        right < this.items.length &&
        this.#compare(this.items[right], this.items[candidate])
      ) {
        candidate = right;
      }

      if (candidate === index) {
        break;
      }

      [this.items[index], this.items[candidate]] = [
        this.items[candidate],
        this.items[index]
      ];
      index = candidate;
    }
  }
}
