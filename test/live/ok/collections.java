import java.util.*;

public class Main {
    public static void main(String[] args) {
        ArrayList<Integer> nums = new ArrayList<>();
        nums.add(3);
        nums.add(1);
        nums.add(2);
        Collections.sort(nums);
        int first = nums.get(0);
        int size = nums.size();
        nums.remove(Integer.valueOf(3));
        System.out.println(first + size + nums.toString());
        for (int n : nums) {
            System.out.println(n);
        }
        Map<String, Integer> count = new HashMap<>();
        String[] words = "a b a c b a".split(" ");
        for (String w : words) {
            count.put(w, count.getOrDefault(w, 0) + 1);
        }
        for (Map.Entry<String, Integer> e : count.entrySet()) {
            String key = e.getKey();
            int v = e.getValue();
            System.out.println(key + "=" + v);
        }
        for (String k : count.keySet()) System.out.println(k);
        Set<String> uniq = new HashSet<>(Arrays.asList(words));
        System.out.println(uniq.contains("a"));
        List<String> list = new LinkedList<>();
        list.add("x");
        String x = list.get(0);
        Iterator<String> it = list.iterator();
        while (it.hasNext()) {
            String s = it.next();
            if (s.isEmpty()) it.remove();
        }
        Deque<Integer> stack = new ArrayDeque<>();
        stack.push(1);
        int top = stack.pop();
        Queue<String> q = new LinkedList<>();
        q.offer("a");
        String head = q.poll();
        int[] arr = {5, 2, 9};
        Arrays.sort(arr);
        System.out.println(Arrays.toString(arr) + x + top + head);
        TreeMap<Integer, List<String>> tm = new TreeMap<>();
        tm.computeIfAbsent(1, k -> new ArrayList<>()).add("one");
        System.out.println(tm.firstKey());
        Random rnd = new Random();
        int dice = rnd.nextInt(6) + 1;
        System.out.println(dice);
    }
}
