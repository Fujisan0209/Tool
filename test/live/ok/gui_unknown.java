import javax.swing.*;
import java.awt.*;
import java.awt.event.*;

public class Main extends JFrame implements ActionListener {
    private JButton button = new JButton("押す");
    private JLabel label = new JLabel("0");
    private int count;

    Main() {
        setTitle("カウンター");
        setSize(300, 200);
        setLayout(new FlowLayout());
        add(button);
        add(label);
        button.addActionListener(this);
        setDefaultCloseOperation(EXIT_ON_CLOSE);
    }

    @Override
    public void actionPerformed(ActionEvent e) {
        count++;
        label.setText(String.valueOf(count));
    }

    public static void main(String[] args) {
        new Main().setVisible(true);
    }
}
